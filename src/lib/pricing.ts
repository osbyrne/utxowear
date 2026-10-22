import { CheckoutError, validateAmount, type Currency } from "./checkout/domain";
import type { StoreProduct } from "./printify/model";

export type PricingConfig = { currency?: string; usdToEurRate?: string };

export function checkoutCurrency(value = "USD"): Currency {
  const currency = value.trim().toUpperCase();
  if (currency !== "USD" && currency !== "EUR")
    throw new CheckoutError("Checkout supports USD and EUR only.", 503);
  return currency;
}

// This storefront sources USD retail prices from its Printify Pop-Up shop.
// Shipping calculations also return USD, even when Printify billing is in EUR.
// The merchant controls the conversion rate; no implicit 1:1 or guessed rate.
export function usdPricing(config: PricingConfig) {
  const currency = checkoutCurrency(config.currency);
  let numerator = 1n;
  let denominator = 1n;
  if (currency === "EUR") {
    const rate = config.usdToEurRate?.trim();
    if (!rate || !/^\d{1,3}(?:\.\d{1,6})?$/.test(rate) || Number(rate) <= 0 || Number(rate) > 100)
      throw new CheckoutError(
        "Euro pricing is unavailable until a valid PRINTIFY_USD_TO_EUR_RATE is configured.",
        503,
      );
    denominator = 10n ** BigInt(rate.split(".")[1]?.length ?? 0);
    numerator = BigInt(rate.replace(".", ""));
  }
  return {
    currency,
    convert(amount: number): number {
      if (!validateAmount(amount)) throw new CheckoutError("Invalid USD price from Printify.", 503);
      // Round each unit price and shipping option once, half up, using integer arithmetic.
      const converted = Number(
        (BigInt(amount) * numerator * 2n + denominator) / (denominator * 2n),
      );
      if (!validateAmount(converted) || (amount > 0 && converted === 0))
        throw new CheckoutError("Converted Printify price is outside checkout limits.", 503);
      return converted;
    },
  };
}

export function priceCatalog(products: StoreProduct[], config: PricingConfig): StoreProduct[] {
  try {
    const pricing = usdPricing(config);
    return products.map((product) => {
      if (product.currency !== "USD")
        throw new CheckoutError("Printify catalog prices must be denominated in USD.", 503);
      return {
        ...product,
        currency: pricing.currency,
        price: pricing.convert(product.price),
        variants: product.variants.map((variant) => ({
          ...variant,
          price: pricing.convert(variant.price),
        })),
      };
    });
  } catch (error) {
    if (!(error instanceof CheckoutError)) throw error;
    // Keep source prices honestly labelled and previewable when conversion is unconfigured.
    return products.map((product) => ({
      ...product,
      checkoutUnavailableReason: "Pricing is temporarily unavailable. Please check back soon.",
    }));
  }
}
