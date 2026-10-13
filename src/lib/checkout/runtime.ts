import { CheckoutError } from "./domain";
import type { CheckoutDatabase } from "./orders";

export type CheckoutBindings = {
  PRINTIFY_API_TOKEN?: string;
  PRINTIFY_SHOP_ID?: string;
  PRINTIFY_CURRENCY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  CHECKOUT_ORIGIN?: string;
  CHECKOUT_DB?: CheckoutDatabase;
};

export async function checkoutBindings(): Promise<CheckoutBindings> {
  try {
    // Static import fails in non-Workers Bun smoke scripts; Workers provide this platform module at runtime.
    const { env } = await import("cloudflare:workers");
    return env as CheckoutBindings;
  } catch {
    // Local non-Workers smoke scripts can use process.env; live Workers never use this path.
    return process.env as CheckoutBindings;
  }
}

export function requireCheckoutConfig(
  bindings: CheckoutBindings,
  request: Request,
): {
  token: string;
  shopId?: string;
  currency?: string;
  stripeKey: string;
  origin: string;
  db: CheckoutDatabase;
} {
  if (
    !bindings.PRINTIFY_API_TOKEN ||
    !bindings.STRIPE_SECRET_KEY ||
    !bindings.STRIPE_WEBHOOK_SECRET ||
    !bindings.CHECKOUT_DB ||
    !bindings.CHECKOUT_ORIGIN
  ) {
    throw new CheckoutError(
      "Checkout is unavailable until payment and fulfillment are configured.",
      503,
    );
  }
  let configured: URL;
  try {
    configured = new URL(bindings.CHECKOUT_ORIGIN);
  } catch {
    throw new CheckoutError("Invalid CHECKOUT_ORIGIN configuration.", 503);
  }
  if (
    configured.origin !== bindings.CHECKOUT_ORIGIN ||
    (configured.protocol !== "https:" &&
      !(
        configured.protocol === "http:" && ["localhost", "127.0.0.1"].includes(configured.hostname)
      )) ||
    configured.origin !== new URL(request.url).origin
  ) {
    throw new CheckoutError("Checkout origin does not match this store.", 503);
  }
  return {
    token: bindings.PRINTIFY_API_TOKEN,
    shopId: bindings.PRINTIFY_SHOP_ID,
    currency: bindings.PRINTIFY_CURRENCY,
    stripeKey: bindings.STRIPE_SECRET_KEY,
    origin: configured.origin,
    db: bindings.CHECKOUT_DB,
  };
}
