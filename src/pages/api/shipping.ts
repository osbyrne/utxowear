import type { APIRoute } from "astro";
import { jsonError, parseCheckoutRequest } from "../../lib/checkout/domain";
import { quoteCart } from "../../lib/checkout/printify";
import { checkoutBindings, requireCheckoutConfig } from "../../lib/checkout/runtime";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const bindings = await checkoutBindings();
    const config = requireCheckoutConfig(bindings, request);
    const { items, address } = await parseCheckoutRequest(request);
    const quote = await quoteCart(config, items, address);
    return Response.json(
      { options: quote.options, currency: "USD", subtotal: quote.subtotal },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};
