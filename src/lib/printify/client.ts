import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  API_BASE_URL,
  ConfigurationError,
  DecodeError,
  HttpStatusError,
  MAX_RETRIES,
  type PrintifyConfig,
  PrintifyProductSchema,
  PrintifyShopArraySchema,
  ProductPageSchema,
  type ProductPage,
  REQUEST_TIMEOUT_MS,
  type Source,
  TimeoutError,
  TransportError,
  USER_AGENT,
} from "./model";
import { type PrintifyProduct, type PrintifyShop, type StoreProduct } from "./model";

export type FetchRequest = Readonly<{
  readonly source: Source;
  readonly path: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly page?: number;
}>;

export type FetchResult = Readonly<{
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly body: string;
}>;

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export type PrintifyFetchService = Readonly<{
  readonly get: (
    request: FetchRequest,
  ) => Effect.Effect<FetchResult, TransportError | TimeoutError | HttpStatusError>;
}>;

export class PrintifyFetch extends Context.Tag("PrintifyFetch")<
  PrintifyFetch,
  PrintifyFetchService
>() {}

export type FetchLayerOptions = Readonly<{
  readonly now?: () => number;
}>;

export type RequestPolicy = Readonly<{
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly jitter: (baseDelayMs: number, retryNumber: number) => number;
}>;

export const DEFAULT_REQUEST_POLICY: RequestPolicy = Object.freeze({
  maxRetries: MAX_RETRIES,
  baseDelayMs: 250,
  jitter: (baseDelayMs) => Math.floor(Math.random() * baseDelayMs),
});

export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isSafeInteger(seconds)) return seconds * 1000;
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

export function isRetryableError(error: TransportError | TimeoutError | HttpStatusError): boolean {
  return (
    error._tag === "TransportError" ||
    error._tag === "TimeoutError" ||
    (error._tag === "HttpStatusError" &&
      (error.status === 408 ||
        error.status === 429 ||
        (error.status >= 500 && error.status <= 599)))
  );
}

export function retryDelayMs(
  error: TransportError | TimeoutError | HttpStatusError,
  retryNumber: number,
  policy: RequestPolicy = DEFAULT_REQUEST_POLICY,
): number {
  if (error._tag === "HttpStatusError" && error.retryAfterMs !== undefined) {
    return Math.max(0, Math.ceil(error.retryAfterMs));
  }

  const baseDelay = policy.baseDelayMs * 2 ** Math.max(0, retryNumber - 1);
  const jitter = policy.jitter(baseDelay, retryNumber);
  return Math.max(0, Math.ceil(baseDelay + jitter));
}

function requestOnce(
  fetchImplementation: FetchImplementation,
  request: FetchRequest,
  now: () => number,
): Effect.Effect<FetchResult, TransportError | TimeoutError | HttpStatusError> {
  const response = Effect.tryPromise({
    try: (signal) =>
      fetchImplementation(request.url, {
        signal,
        headers: request.headers,
      }).then(async (result) => ({
        status: result.status,
        retryAfter: result.headers.get("retry-after") ?? undefined,
        body: await result.text(),
      })),
    catch: () =>
      new TransportError({
        source: request.source,
        path: request.path,
        page: request.page,
      }),
  });

  return response.pipe(
    Effect.timeoutFail({
      duration: Duration.millis(REQUEST_TIMEOUT_MS),
      onTimeout: () =>
        new TimeoutError({
          source: request.source,
          path: request.path,
          page: request.page,
        }),
    }),
    Effect.flatMap((result) =>
      result.status >= 200 && result.status < 300
        ? Effect.succeed(result)
        : Effect.fail(
            new HttpStatusError({
              source: request.source,
              path: request.path,
              status: result.status,
              page: request.page,
              retryAfterMs: parseRetryAfter(result.retryAfter, now()),
            }),
          ),
    ),
  );
}

function makeFetchService(
  fetchImplementation: FetchImplementation,
  options: FetchLayerOptions = {},
): PrintifyFetchService {
  const now = options.now ?? Date.now;
  return {
    get: (request) => requestOnce(fetchImplementation, request, now),
  };
}

export function makeFetchLayer(
  fetchImplementation: FetchImplementation,
  options: FetchLayerOptions = {},
): Layer.Layer<PrintifyFetch> {
  return Layer.succeed(PrintifyFetch, makeFetchService(fetchImplementation, options));
}

const liveFetch: FetchImplementation = (input, init) => globalThis.fetch(input, init);

export const FetchLive = makeFetchLayer(liveFetch);

export function requestText(
  request: FetchRequest,
  policy: RequestPolicy = DEFAULT_REQUEST_POLICY,
): Effect.Effect<string, TransportError | TimeoutError | HttpStatusError, PrintifyFetch> {
  return Effect.gen(function* () {
    const fetchService = yield* PrintifyFetch;

    for (let retryNumber = 0; ; retryNumber += 1) {
      const outcome = yield* fetchService.get(request).pipe(Effect.either);
      if (Either.isRight(outcome)) return outcome.right.body;

      const error = outcome.left;
      if (!isRetryableError(error) || retryNumber >= policy.maxRetries) {
        return yield* Effect.fail(error);
      }

      yield* Effect.sleep(Duration.millis(retryDelayMs(error, retryNumber + 1, policy)));
    }
  });
}

function apiToken(config: PrintifyConfig): Effect.Effect<string, ConfigurationError> {
  return config.token
    ? Effect.succeed(config.token)
    : Effect.fail(
        new ConfigurationError({
          field: "token",
          reason: "an API token is required for authenticated requests",
        }),
      );
}

function apiRequest(
  config: PrintifyConfig,
  path: string,
  page?: number,
): Effect.Effect<
  string,
  TransportError | TimeoutError | HttpStatusError | ConfigurationError,
  PrintifyFetch
> {
  return Effect.gen(function* () {
    const token = yield* apiToken(config);
    return yield* requestText({
      source: "api",
      path,
      url: `${API_BASE_URL}${path}`,
      page,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
    });
  });
}

function publicRequest(
  config: PrintifyConfig,
): Effect.Effect<string, TransportError | TimeoutError | HttpStatusError, PrintifyFetch> {
  return requestText({
    source: "public",
    path: "storefront",
    url: config.storeUrl,
    headers: { "User-Agent": USER_AGENT },
  });
}

function decodeJson<A, I>(
  body: string,
  schema: Schema.Schema<A, I>,
  source: Source,
  path: string,
  page?: number,
): Effect.Effect<A, DecodeError> {
  return Effect.gen(function* () {
    const decodedJson: unknown = yield* Effect.try({
      try: () => JSON.parse(body),
      catch: () => "invalid-json",
    }).pipe(Effect.mapError(() => newDecodeError(source, path, page)));

    return yield* Schema.decodeUnknown(schema)(decodedJson).pipe(
      Effect.mapError(() => newDecodeError(source, path, page)),
    );
  });
}

function newDecodeError(source: Source, path: string, page?: number): DecodeError {
  return new DecodeError({ source, path, page });
}

export function fetchPublicStorefront(
  config: PrintifyConfig,
): Effect.Effect<string, TransportError | TimeoutError | HttpStatusError, PrintifyFetch> {
  return publicRequest(config);
}

export function fetchShops(
  config: PrintifyConfig,
): Effect.Effect<
  readonly PrintifyShop[],
  TransportError | TimeoutError | HttpStatusError | DecodeError | ConfigurationError,
  PrintifyFetch
> {
  return Effect.gen(function* () {
    const body = yield* apiRequest(config, "/shops.json");
    return yield* decodeJson(body, PrintifyShopArraySchema, "api", "/shops.json");
  });
}

export function fetchProductPage(
  config: PrintifyConfig,
  shopId: number,
  page: number,
): Effect.Effect<
  ProductPage,
  TransportError | TimeoutError | HttpStatusError | DecodeError | ConfigurationError,
  PrintifyFetch
> {
  const path = `/shops/${shopId}/products.json?limit=50&page=${page}`;
  return Effect.gen(function* () {
    const body = yield* apiRequest(config, path, page);
    return yield* decodeJson(body, ProductPageSchema, "api", path, page);
  });
}

export function decodeProduct(value: unknown): Effect.Effect<PrintifyProduct, DecodeError> {
  return Schema.decodeUnknown(PrintifyProductSchema)(value).pipe(
    Effect.mapError(() => newDecodeError("api", "product")),
  );
}

export type { PrintifyProduct, StoreProduct };
