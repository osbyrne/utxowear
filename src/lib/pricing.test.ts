import { expect, test } from "bun:test";
import { usdPricing } from "./pricing";

test("money stays in integer cents and EUR conversion fails closed instead of relabelling USD", () => {
  expect(usdPricing({ currency: "USD" }).convert(1751)).toBe(1751);
  expect(usdPricing({ currency: "EUR", usdToEurRate: "0.8" }).convert(1751)).toBe(1401);
  expect(usdPricing({ currency: "EUR", usdToEurRate: "0.5" }).convert(1)).toBe(1);
  expect(() => usdPricing({ currency: "EUR" })).toThrow("RATE");
  expect(() => usdPricing({ currency: "EUR", usdToEurRate: "0.1" }).convert(1)).toThrow("limits");
});
