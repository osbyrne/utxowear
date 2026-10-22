import type { APIRoute } from "astro";
import { CheckoutError, jsonError, parseCheckoutRequest } from "../../lib/checkout/domain";
import { checkoutCurrency } from "../../lib/pricing";
import { quoteCart } from "../../lib/checkout/printify";
import { checkoutBindings, requireCheckoutConfig } from "../../lib/checkout/runtime";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const bindings = await checkoutBindings();
    const config = requireCheckoutConfig(bindings, request);
    const { items, address, currency } = await parseCheckoutRequest(request);
    if (currency !== checkoutCurrency(config.currency))
      throw new CheckoutError(
        "Store currency changed. Refresh your bag and request shipping again.",
        409,
      );
    const quote = await quoteCart(config, items, address);
    return Response.json(
      { options: quote.options, currency: quote.currency, subtotal: quote.subtotal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};
