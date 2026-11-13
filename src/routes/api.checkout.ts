import { createFileRoute } from "@tanstack/react-router";
import { CheckoutError, jsonError, parseCheckoutRequest } from "../lib/checkout/domain";
import { quoteCart } from "../lib/checkout/printify";
import { checkoutBindings, requireCheckoutConfig } from "../lib/checkout/runtime";
import { createStripeSession } from "../lib/checkout/stripe";
import { checkoutCurrency } from "../lib/pricing";

const handlePost = async ({ request }: { request: Request }) => {
  try {
    const bindings = await checkoutBindings();
    const config = requireCheckoutConfig(bindings, request);
    const { items, address, shippingMethod, currency, expectedTotal } = await parseCheckoutRequest(
      request,
      true,
    );
    if (currency !== checkoutCurrency(config.currency))
      throw new CheckoutError(
        "Store currency changed. Refresh your bag and request shipping again.",
        409,
      );
    const quote = await quoteCart(config, items, address);
    const option = quote.options.find(({ method }) => method === shippingMethod);
    if (!option)
      throw new CheckoutError("Selected shipping method is unavailable for this address.");
    if (quote.subtotal + option.price !== expectedTotal)
      throw new CheckoutError(
        "Prices changed. Request shipping again before continuing to payment.",
        409,
      );
    const url = await createStripeSession(config.stripeKey, config.origin, quote, option);
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
};

export const Route = createFileRoute("/api/checkout")({
  server: { handlers: { POST: handlePost } },
});
