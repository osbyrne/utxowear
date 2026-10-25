import { CheckoutError } from "./domain";

export type FulfillmentBindings = {
  FULFILLMENT_MODE?: string;
  PRINTIFY_SHOP_ID?: string;
  PRINTIFY_TEST_SHOP_ID?: string;
};

export type FulfillmentEnvironment = {
  mode: "simulate" | "production" | "test";
  shopId?: string;
};

export function fulfillmentEnvironment(bindings: FulfillmentBindings): FulfillmentEnvironment {
  const mode = bindings.FULFILLMENT_MODE ?? "simulate";
  if (mode !== "simulate" && mode !== "production" && mode !== "test")
    throw new CheckoutError("Invalid FULFILLMENT_MODE configuration.", 503);
  const productionShop = bindings.PRINTIFY_SHOP_ID?.trim();
  if (
    (productionShop && !/^[1-9]\d*$/.test(productionShop)) ||
    (!productionShop && mode !== "simulate")
  )
    throw new CheckoutError("Set PRINTIFY_SHOP_ID to the production shop ID.", 503);
  if (mode !== "test") return { mode, shopId: productionShop || undefined };
  const testShop = bindings.PRINTIFY_TEST_SHOP_ID?.trim();
  if (!testShop || !/^[1-9]\d*$/.test(testShop) || testShop === productionShop)
    throw new CheckoutError("Test fulfillment requires a separate PRINTIFY_TEST_SHOP_ID.", 503);
  return { mode, shopId: testShop };
}

export function requireStripeKeyMode(secret: string, environment: FulfillmentEnvironment): void {
  const mode = /^(?:sk|rk)_(live|test)_/.exec(secret)?.[1];
  if (mode !== (environment.mode === "production" ? "live" : "test"))
    throw new CheckoutError("Stripe API key mode does not match FULFILLMENT_MODE.", 503);
}

export function requireStripeEventMode(
  environment: FulfillmentEnvironment,
  eventMode: unknown,
  sessionMode: unknown,
): void {
  if (
    typeof eventMode !== "boolean" ||
    typeof sessionMode !== "boolean" ||
    eventMode !== sessionMode ||
    eventMode !== (environment.mode === "production")
  )
    throw new CheckoutError("Stripe payment mode does not match FULFILLMENT_MODE.", 400);
}
