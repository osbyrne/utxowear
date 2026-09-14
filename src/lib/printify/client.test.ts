import { describe, expect, test } from "bun:test";
import * as Either from "effect/Either";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";

import {
  fetchShops,
  makeFetchLayer,
  parseRetryAfter,
  requestText,
  type FetchImplementation,
  type PrintifyFetch,
} from "./client";
import { normalizePrintifyConfig } from "./model";

const config = normalizePrintifyConfig({}).config;

const request = {
  source: "public" as const,
  path: "storefront",
  url: config.storeUrl,
  headers: { "User-Agent": "utxowear-storefront/1.0" },
};

function provideRequest<A, E>(
  fetchImplementation: FetchImplementation,
  effect: Effect.Effect<A, E, PrintifyFetch>,
): Effect.Effect<A, E> {
  return Effect.provide(effect, makeFetchLayer(fetchImplementation, { now: () => 0 }));
}

describe("Printify fetch service", () => {
  test("passes the user agent and does not add auth to public requests", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: FetchImplementation = async (input, init) => {
      calls.push({ input, init });
      return new Response("body", { status: 200 });
    };

    const body = await Effect.runPromise(
      provideRequest(
        fetchImplementation,
        requestText(request, {
          maxRetries: 0,
          baseDelayMs: 250,
          jitter: () => 0,
        }),
      ),
    );

    expect(body).toBe("body");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(config.storeUrl);
    expect(calls[0]?.init?.headers).toEqual({
      "User-Agent": "utxowear-storefront/1.0",
    });
    expect(calls[0]?.init?.headers).not.toHaveProperty("Authorization");
  });

  test("adds the bearer token only to authenticated API requests", async () => {
    let headers: HeadersInit | undefined;
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      headers = init?.headers;
      return new Response("[]", { status: 200 });
    };
    const apiConfig = { ...config, token: "synthetic-token" };

    await Effect.runPromise(provideRequest(fetchImplementation, fetchShops(apiConfig)));

    expect(headers).toEqual({
      Authorization: "Bearer synthetic-token",
      "User-Agent": "utxowear-storefront/1.0",
    });
  });

  test("never retries a permanent client error", async () => {
    let attempts = 0;
    const fetchImplementation: FetchImplementation = async () => {
      attempts += 1;
      return new Response("unauthorized", { status: 401 });
    };

    const outcome = await Effect.runPromise(
      Effect.either(
        provideRequest(
          fetchImplementation,
          requestText(request, {
            maxRetries: 2,
            baseDelayMs: 250,
            jitter: () => 0,
          }),
        ),
      ),
    );

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome) && outcome.left._tag === "HttpStatusError") {
      expect(outcome.left._tag).toBe("HttpStatusError");
      expect(outcome.left.status).toBe(401);
    }
    expect(attempts).toBe(1);
  });

  test("retries transient failures at most twice using the Effect test clock", async () => {
    let attempts = 0;
    const fetchImplementation: FetchImplementation = async () => {
      attempts += 1;
      return new Response(attempts < 3 ? "temporarily unavailable" : "success", {
        status: attempts < 3 ? 503 : 200,
      });
    };

    const requestEffect = Effect.either(
      provideRequest(
        fetchImplementation,
        requestText(request, {
          maxRetries: 2,
          baseDelayMs: 250,
          jitter: () => 0,
        }),
      ),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(requestEffect);
      yield* Effect.yieldNow();
      yield* TestClock.adjust("1 second");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.defaultTestClock), Effect.provide(TestContext.TestContext));

    const outcome = await Effect.runPromise(program);
    expect(outcome).toEqual(Either.right("success"));
    expect(attempts).toBe(3);
  });

  test("aborts a hung response body when the per-attempt timeout expires", async () => {
    let aborted = false;
    const fetchImplementation: FetchImplementation = async (_input, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return {
        status: 200,
        headers: new Headers(),
        text: () => new Promise<string>(() => undefined),
      } as Response;
    };

    const requestEffect = Effect.either(
      provideRequest(
        fetchImplementation,
        requestText(request, {
          maxRetries: 0,
          baseDelayMs: 250,
          jitter: () => 0,
        }),
      ),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(requestEffect);
      yield* Effect.yieldNow();
      yield* TestClock.adjust("10 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.defaultTestClock), Effect.provide(TestContext.TestContext));

    const outcome = await Effect.runPromise(program);
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) expect(outcome.left._tag).toBe("TimeoutError");
    expect(aborted).toBe(true);
  });
});

describe("Retry-After", () => {
  test("parses delta-seconds and HTTP dates without exposing the header", () => {
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("Mon, 01 Jan 2001 00:00:02 GMT", 0)).toBe(978307202000);
    expect(parseRetryAfter("not-a-date", 0)).toBeUndefined();
  });
});
