import fallbackProductNames from "../../../products.json";
import * as Either from "effect/Either";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import {
  BudgetExceededError,
  ConfigurationError,
  DecodeError,
  ExtractionError,
  HttpStatusError,
  MAX_API_PAGES,
  PaginationError,
  type PrintifyConfig,
  type PrintifyError,
  type PublicStoreProduct,
  ShopSelectionError,
  SOURCE_BUDGET_MS,
  type Source,
  TimeoutError,
  TransportError,
  validatePrintifyConfig,
} from "./model";
import type { StoreProduct } from "./model";
import {
  chooseShop,
  extractPublicProducts,
  normalizeApiProducts,
  normalizePublicProduct,
} from "./parsing";
import { fetchProductPage, fetchPublicStorefront, fetchShops } from "./client";
import type { PrintifyProduct } from "./model";

export type CatalogDiagnostic = Readonly<{
  readonly source: Source;
  readonly tag: string;
  readonly status?: number;
  readonly page?: number;
}>;

export type CatalogOptions = Readonly<{
  readonly log?: (diagnostic: CatalogDiagnostic) => void;
  readonly fallbackNames?: readonly string[];
}>;

type PublicSourceError =
  | TransportError
  | TimeoutError
  | HttpStatusError
  | ExtractionError
  | BudgetExceededError;

type ApiSourceError =
  | TransportError
  | TimeoutError
  | HttpStatusError
  | DecodeError
  | ConfigurationError
  | ShopSelectionError
  | PaginationError
  | BudgetExceededError;

const defaultLog = (diagnostic: CatalogDiagnostic): void => {
  const metadata = [
    diagnostic.status === undefined ? undefined : `status=${diagnostic.status}`,
    diagnostic.page === undefined ? undefined : `page=${diagnostic.page}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const suffix = metadata ? ` ${metadata}` : "";
  console.warn(`[Printify] ${diagnostic.source} source exhausted (${diagnostic.tag})${suffix}.`);
};

export function diagnosticFor(source: Source, error: PrintifyError): CatalogDiagnostic {
  if (error._tag === "HttpStatusError") {
    return {
      source,
      tag: error._tag,
      status: error.status,
      page: error.page,
    };
  }

  if (
    error._tag === "TransportError" ||
    error._tag === "TimeoutError" ||
    error._tag === "DecodeError"
  ) {
    return { source, tag: error._tag, page: error.page };
  }

  if (error._tag === "PaginationError") {
    return { source, tag: error._tag, page: error.page };
  }

  return { source, tag: error._tag };
}

function withSourceBudget<A, E, R>(
  source: Source,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | BudgetExceededError, R> {
  return effect.pipe(
    Effect.timeoutFail({
      duration: Duration.millis(SOURCE_BUDGET_MS),
      onTimeout: () => new BudgetExceededError({ source }),
    }),
  );
}

function publicSource(
  config: PrintifyConfig,
): Effect.Effect<
  readonly PublicStoreProduct[],
  PublicSourceError,
  import("./client").PrintifyFetch
> {
  return Effect.gen(function* () {
    const html = yield* fetchPublicStorefront(config);
    const result = extractPublicProducts(html);
    if (result._tag === "Success") return result.products;

    return yield* Effect.fail(new ExtractionError({ source: "public", path: result.reason }));
  });
}

function apiSource(
  config: PrintifyConfig,
  publicProducts: readonly PublicStoreProduct[],
): Effect.Effect<StoreProduct[], ApiSourceError, import("./client").PrintifyFetch> {
  return Effect.gen(function* () {
    const shops = yield* fetchShops(config);
    const shop = chooseShop(shops, config);
    if (!shop) {
      return yield* Effect.fail(
        config.shopId
          ? new ShopSelectionError({
              shopId: config.shopId,
              storeSlug: config.storeSlug,
            })
          : new ShopSelectionError({ storeSlug: config.storeSlug }),
      );
    }

    const products: PrintifyProduct[] = [];
    let expectedLastPage: number | undefined;

    for (let page = 1; ; page += 1) {
      if (page > MAX_API_PAGES) {
        return yield* Effect.fail(new PaginationError({ page, lastPage: expectedLastPage }));
      }

      const response = yield* fetchProductPage(config, shop.id, page);
      if (response.last_page > MAX_API_PAGES) {
        return yield* Effect.fail(
          new PaginationError({
            page,
            lastPage: response.last_page,
          }),
        );
      }

      if (expectedLastPage === undefined) {
        expectedLastPage = response.last_page;
      } else if (response.last_page !== expectedLastPage) {
        return yield* Effect.fail(
          new PaginationError({
            page,
            lastPage: response.last_page,
          }),
        );
      }

      if (response.current_page !== undefined && response.current_page !== page) {
        return yield* Effect.fail(
          new PaginationError({
            page,
            lastPage: response.last_page,
          }),
        );
      }

      products.push(...response.data);
      if (page >= response.last_page) break;
    }

    return normalizeApiProducts(products, publicProducts, config);
  });
}

function fallbackProducts(config: PrintifyConfig, names: readonly string[]): StoreProduct[] {
  return names.map((title, index) => ({
    id: `fallback-${index}`,
    title,
    description: "Heavyweight cotton / unisex fit",
    price: 6400,
    currency: "USD",
    href: config.storeUrl,
    mockups: ["/shirt_transparent.png"],
  }));
}

function normalizePublicProducts(
  products: readonly PublicStoreProduct[],
  config: PrintifyConfig,
): StoreProduct[] {
  return products
    .map((product) => normalizePublicProduct(product, config))
    .filter((product): product is StoreProduct => Boolean(product));
}

export function makeCatalog(
  config: PrintifyConfig,
  options: CatalogOptions = {},
): Effect.Effect<StoreProduct[], ConfigurationError, import("./client").PrintifyFetch> {
  const log = options.log ?? defaultLog;
  const names = options.fallbackNames ?? fallbackProductNames;

  return Effect.gen(function* () {
    const validated = validatePrintifyConfig(config);
    if (validated instanceof ConfigurationError) {
      return yield* Effect.fail(validated);
    }

    const publicOutcome = yield* Effect.either(withSourceBudget("public", publicSource(validated)));
    const publicProducts: readonly PublicStoreProduct[] = Either.isRight(publicOutcome)
      ? publicOutcome.right
      : [];

    if (Either.isLeft(publicOutcome)) {
      log(diagnosticFor("public", publicOutcome.left));
    }

    const publicStoreProducts = normalizePublicProducts(publicProducts, validated);

    if (validated.token) {
      const apiOutcome = yield* Effect.either(
        withSourceBudget("api", apiSource(validated, publicProducts)),
      );

      if (Either.isRight(apiOutcome) && apiOutcome.right.length > 0) {
        return apiOutcome.right;
      }

      if (Either.isLeft(apiOutcome)) {
        log(diagnosticFor("api", apiOutcome.left));
      } else {
        log({ source: "api", tag: "EmptyCatalog" });
      }
    }

    if (publicStoreProducts.length > 0) return publicStoreProducts;
    if (Either.isRight(publicOutcome)) {
      log({ source: "public", tag: "EmptyCatalog" });
    }

    return fallbackProducts(validated, names);
  });
}
