import { describe, expect, test } from "bun:test";

import { configFromEnvironment } from "./printify";

describe("Printify environment translation", () => {
  test("trims credentials and optional shop IDs without exposing them in warnings", () => {
    const result = configFromEnvironment({
      PRINTIFY_API_TOKEN: "  synthetic-token  ",
      PRINTIFY_SHOP_ID: " 42 ",
      PRINTIFY_STORE_URL: " https://shop.example/ ",
      PRINTIFY_CURRENCY: " eur ",
    });

    expect(result.config).toMatchObject({
      token: "synthetic-token",
      shopId: "42",
      storeUrl: "https://shop.example/",
      storeSlug: "shop",
      currency: "EUR",
    });
    expect(JSON.stringify(result.warnings)).not.toContain("synthetic-token");
  });

  test("uses safe defaults for invalid optional overrides", () => {
    const result = configFromEnvironment({
      PRINTIFY_API_TOKEN: "synthetic-token",
      PRINTIFY_STORE_URL: "javascript:alert(1)",
      PRINTIFY_CURRENCY: "not-a-currency",
    });

    expect(result.config.storeUrl).toBe("https://utxowear.printify.me/");
    expect(result.config.currency).toBe("USD");
    expect(result.warnings).toEqual([
      {
        field: "storeUrl",
        message: "PRINTIFY_STORE_URL is invalid; using the default storefront URL.",
      },
      {
        field: "currency",
        message: "PRINTIFY_CURRENCY is invalid; using USD.",
      },
    ]);
  });
});
