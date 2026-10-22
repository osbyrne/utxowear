import { describe, expect, test } from "bun:test";
import { priceCatalog, usdPricing } from "./pricing";
import type { StoreProduct } from "./printify/model";

const product: StoreProduct = {
  id: "product-1",
  title: "Tee",
  description: "",
  currency: "USD",
  price: 1751,
  mockups: [],
  defaultVariantId: 1,
  variants: [{ id: 1, title: "M", price: 1751, options: [] }],
};

describe("server-controlled USD pricing", () => {
  test("converts catalog and variant cents with the same half-up policy as checkout", () => {
    const [converted] = priceCatalog([product], { currency: "EUR", usdToEurRate: "0.8" });
    expect(converted).toMatchObject({ currency: "EUR", price: 1401, variants: [{ price: 1401 }] });
    expect(product.price).toBe(1751);
    expect(product.currency).toBe("USD");
    expect(priceCatalog([product], { currency: "USD" })).toEqual([product]);
    expect(usdPricing({ currency: " eur ", usdToEurRate: "0.5" }).convert(1)).toBe(1);
    expect(usdPricing({ currency: "EUR", usdToEurRate: "0.000001" }).convert(99_999_999)).toBe(100);
  });

  test("does not relabel USD as EUR or enable checkout without a conversion rate", () => {
    expect(priceCatalog([product], { currency: "EUR" })[0]).toMatchObject({
      currency: "USD",
      price: 1751,
      checkoutUnavailableReason: expect.stringContaining("Pricing is temporarily unavailable"),
    });
  });

  test.each(["", "0", "-1", "Infinity", "NaN", "1e-1", "1,2", "0.1234567", "101"])(
    "rejects invalid rate %s",
    (rate) => {
      expect(() => usdPricing({ currency: "EUR", usdToEurRate: rate })).toThrow("RATE");
    },
  );

  test("rejects mixed source currencies and unsafe or zero-rounded prices", () => {
    expect(
      priceCatalog([product, { ...product, currency: "EUR" }], {
        currency: "EUR",
        usdToEurRate: "0.8",
      }).every((product) => product.checkoutUnavailableReason),
    ).toBe(true);
    expect(() => usdPricing({ currency: "EUR", usdToEurRate: "2" }).convert(99_999_999)).toThrow(
      "limits",
    );
    expect(() => usdPricing({ currency: "EUR", usdToEurRate: "0.1" }).convert(1)).toThrow("limits");
    expect(() => usdPricing({}).convert(12.5)).toThrow("Invalid USD");
    expect(usdPricing({ currency: "EUR", usdToEurRate: "0.8" }).convert(0)).toBe(0);
  });
});
