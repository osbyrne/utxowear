import { createFileRoute } from "@tanstack/react-router";
import { CheckoutError, jsonError, parseCheckoutRequest } from "../lib/checkout/domain";
import { checkoutCurrency } from "../lib/pricing";
import { quoteCart } from "../lib/checkout/printify";
import { checkoutBindings, requireCheckoutConfig } from "../lib/checkout/runtime";

const handlePost = async ({ request }: { request: Request }) => {
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

export const Route = createFileRoute("/api/shipping")({
  server: { handlers: { POST: handlePost } },
});
