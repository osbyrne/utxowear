import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";

import { makeFetchLayer, type FetchImplementation } from "./client";
import { makeCatalog, type CatalogDiagnostic } from "./catalog";
import { normalizePrintifyConfig, type StoreProduct } from "./model";

const publicProduct = {
  id: 1,
  title: "Public shirt",
  description: "<p>Public</p>",
  image: "https://cdn.example/public.png",
  externalId: "api-shirt",
  path: "/products/public-shirt",
  defaultVariant: { retailPrice: 6400 },
};

const apiProduct = {
  id: "api-shirt",
  title: "API shirt",
  description: "<p>API</p>",
  visible: true,
  options: [
    {
      name: "Size",
      values: [
        { id: 10, title: "S" },
        { id: 11, title: "M" },
      ],
    },
  ],
  images: [
    { src: "default.png", position: "back", is_default: true, variant_ids: [102] },
    { src: "front.png", position: "front", is_default: false, variant_ids: [101] },
  ],
  variants: [
    { id: 101, title: "S", options: [10], price: 7200, is_enabled: true, is_default: false },
    { id: 102, title: "M", options: [11], price: 6800, is_enabled: true, is_default: true },
  ],
};

function flightChunk(content: string): string {
  return `<script>self.__next_f.push(${JSON.stringify([1, content])})</script>`;
}

function storefront(products: unknown): string {
  return flightChunk(`{"products":${JSON.stringify(products)}`);
}

function response(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, { status, headers });
}

function config(overrides: Parameters<typeof normalizePrintifyConfig>[0] = {}) {
  return normalizePrintifyConfig({
    storeUrl: "https://utxowear.printify.me/",
    currency: "EUR",
    token: "synthetic-token",
    ...overrides,
  }).config;
}

function apiShop(): string {
  return JSON.stringify([{ id: 42, title: " UTXOWEAR " }]);
}

function apiPage(products: readonly unknown[], lastPage = 1, currentPage?: number): string {
  return JSON.stringify({
    data: products,
    last_page: lastPage,
    ...(currentPage === undefined ? {} : { current_page: currentPage }),
  });
}

async function runCatalog(
  fetchImplementation: FetchImplementation,
  options: Parameters<typeof makeCatalog>[1] = {},
  configValue = config({ token: "synthetic-token" }),
): Promise<StoreProduct[]> {
  const effect = makeCatalog(configValue, options);
  return Effect.runPromise(
    Effect.provide(effect, makeFetchLayer(fetchImplementation, { now: () => 0 })),
  );
}

describe("catalog source precedence and fallbacks", () => {
  test("uses public products without making API requests when no token is configured", async () => {
    const calls: string[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      calls.push(input);
      return response(storefront([publicProduct]));
    };

    const products = await runCatalog(fetchImplementation, {}, config({ token: undefined }));

    expect(products).toEqual([
      {
        id: "api-shirt",
        title: "Public shirt",
        description: "Public",
        price: 6400,
        currency: "EUR",
        mockups: ["https://cdn.example/public.png"],
        variants: [],
        defaultVariantId: null,
      },
    ]);
    expect(calls).toEqual(["https://utxowear.printify.me/"]);
  });

  test("loads every sequential API page and preserves API source order", async () => {
    const calls: string[] = [];
    const secondProduct = { ...apiProduct, id: "api-shirt-2", title: "Second" };
    const fetchImplementation: FetchImplementation = async (input) => {
      calls.push(input);
      if (input === config().storeUrl) return response(storefront([publicProduct]));
      if (input.endsWith("/shops.json")) return response(apiShop());
      if (input.endsWith("page=1")) return response(apiPage([apiProduct], 2, 1));
      if (input.endsWith("page=2")) return response(apiPage([secondProduct], 2, 2));
      return response("not found", 404);
    };

    const products = await runCatalog(fetchImplementation);
    expect(products.map((product) => product.id)).toEqual(["api-shirt", "api-shirt-2"]);
    expect(calls).toEqual([
      "https://utxowear.printify.me/",
      "https://api.printify.com/v1/shops.json",
      "https://api.printify.com/v1/shops/42/products.json?limit=50&page=1",
      "https://api.printify.com/v1/shops/42/products.json?limit=50&page=2",
    ]);
  });

  test("falls back to public products after API status, decode, shop, and later-page failures", async () => {
    const cases: Array<{
      name: string;
      api: (input: string) => Response;
    }> = [
      {
        name: "status",
        api: () => response("forbidden", 403),
      },
      {
        name: "decode",
        api: (input) =>
          input.endsWith("/shops.json")
            ? response("{changed-shape:true}")
            : response(apiPage([apiProduct])),
      },
      {
        name: "missing shop",
        api: () => response(JSON.stringify([{ id: 99, title: "other" }])),
      },
      {
        name: "later page",
        api: (input) => {
          if (input.endsWith("/shops.json")) return response(apiShop());
          if (input.endsWith("page=1")) return response(apiPage([apiProduct], 2, 1));
          return response("later page failed", 401);
        },
      },
    ];

    for (const testCase of cases) {
      const diagnostics: CatalogDiagnostic[] = [];
      const fetchImplementation: FetchImplementation = async (input) => {
        if (input === config().storeUrl) return response(storefront([publicProduct]));
        return testCase.api(input);
      };

      const products = await runCatalog(fetchImplementation, {
        log: (diagnostic) => diagnostics.push(diagnostic),
      });
      expect(products).toMatchObject([{ id: "api-shirt", price: 6400 }]);
      expect(diagnostics.some((diagnostic) => diagnostic.source === "api")).toBe(true);
      expect(JSON.stringify(diagnostics)).not.toContain("synthetic-token");
    }
  });

  test("uses the original local catalog when both remote sources fail", async () => {
    const fetchImplementation: FetchImplementation = async (input) =>
      input === config().storeUrl ? response("public failed", 404) : response("api failed", 401);

    const products = await runCatalog(fetchImplementation, {
      fallbackNames: ["local shirt", "local hat"],
    });
    expect(products).toEqual([
      {
        id: "fallback-0",
        title: "local shirt",
        description: "Heavyweight cotton / unisex fit",
        price: 6400,
        currency: "USD",
        mockups: ["/shirt_transparent.png"],
        variants: [],
        defaultVariantId: null,
      },
      {
        id: "fallback-1",
        title: "local hat",
        description: "Heavyweight cotton / unisex fit",
        price: 6400,
        currency: "USD",
        mockups: ["/shirt_transparent.png"],
        variants: [],
        defaultVariantId: null,
      },
    ]);
  });

  test("rejects explicit shop mismatches and malformed pagination without publishing partial API pages", async () => {
    const diagnostics: CatalogDiagnostic[] = [];
    const fetchImplementation: FetchImplementation = async (input) => {
      if (input === config().storeUrl) return response(storefront([publicProduct]));
      if (input.endsWith("/shops.json")) return response(apiShop());
      return response(apiPage([apiProduct], 101, 1));
    };

    const products = await runCatalog(
      fetchImplementation,
      { log: (diagnostic) => diagnostics.push(diagnostic) },
      config({ shopId: "missing" }),
    );
    expect(products).toMatchObject([{ id: "api-shirt", price: 6400 }]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: "api", tag: "ShopSelectionError" }),
    );

    diagnostics.length = 0;
    const pageCapProducts = await runCatalog(fetchImplementation, {
      log: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(pageCapProducts).toMatchObject([{ id: "api-shirt", price: 6400 }]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: "api", tag: "PaginationError" }),
    );
  });

  test("bounds transient failures and completes with the test clock", async () => {
    let shopAttempts = 0;
    const fetchImplementation: FetchImplementation = async (input) => {
      if (input === config().storeUrl) return response(storefront([publicProduct]));
      if (input.endsWith("/shops.json")) {
        shopAttempts += 1;
        return shopAttempts === 1 ? response("temporary", 503) : response(apiShop());
      }
      return response(apiPage([apiProduct]));
    };

    const effect = Effect.provide(
      makeCatalog(config(), { log: () => undefined }),
      makeFetchLayer(fetchImplementation, { now: () => 0 }),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(effect);
      yield* Effect.yieldNow();
      yield* TestClock.adjust("1 second");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.defaultTestClock), Effect.provide(TestContext.TestContext));

    const products = await Effect.runPromise(program);
    expect(products).toMatchObject([{ id: "api-shirt", price: 6800 }]);
    expect(shopAttempts).toBe(2);
  });

  test("falls back when Retry-After exceeds the source budget", async () => {
    let attempts = 0;
    const diagnostics: CatalogDiagnostic[] = [];
    const fetchImplementation: FetchImplementation = async () => {
      attempts += 1;
      return response("slow down", 429, { "Retry-After": "120" });
    };
    const effect = Effect.provide(
      makeCatalog(config({ token: undefined }), {
        fallbackNames: ["budget fallback"],
        log: (diagnostic) => diagnostics.push(diagnostic),
      }),
      makeFetchLayer(fetchImplementation, { now: () => 0 }),
    );
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(effect);
      yield* Effect.yieldNow();
      yield* TestClock.adjust("60 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.defaultTestClock), Effect.provide(TestContext.TestContext));

    const products = await Effect.runPromise(program);
    expect(products).toMatchObject([{ title: "budget fallback", currency: "USD" }]);
    expect(attempts).toBe(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: "public", tag: "BudgetExceededError" }),
    );
  });
});
