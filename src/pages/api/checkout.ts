import type { APIRoute } from "astro";
import { CheckoutError, jsonError, parseCheckoutRequest } from "../../lib/checkout/domain";
import { quoteCart } from "../../lib/checkout/printify";
import { checkoutBindings, requireCheckoutConfig } from "../../lib/checkout/runtime";
import { createStripeSession } from "../../lib/checkout/stripe";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const bindings = await checkoutBindings();
    const config = requireCheckoutConfig(bindings, request);
    const { items, address, shippingMethod } = await parseCheckoutRequest(request, true);
    const quote = await quoteCart(config, items, address);
    const option = quote.options.find(({ method }) => method === shippingMethod);
    if (!option)
      throw new CheckoutError("Selected shipping method is unavailable for this address.");
    const url = await createStripeSession(config.stripeKey, config.origin, quote, option);
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
};
