import type { APIRoute } from "astro";
import { CheckoutError, jsonError } from "../../lib/checkout/domain";
import { claimOrder, markOrderCreated, markOrderUncertain } from "../../lib/checkout/orders";
import { createPrintifyOrder } from "../../lib/checkout/printify";
import { checkoutBindings } from "../../lib/checkout/runtime";
import { checkoutSnapshot, verifyStripeWebhook } from "../../lib/checkout/stripe";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const bindings = await checkoutBindings();
    if (!bindings.STRIPE_WEBHOOK_SECRET || !bindings.PRINTIFY_API_TOKEN || !bindings.CHECKOUT_DB) {
      throw new CheckoutError("Webhook fulfillment is not configured.", 503);
    }
    if (Number(request.headers.get("content-length")) > 100_000)
      throw new CheckoutError("Webhook is too large.", 413);
    const body = await request.text(); // Stripe signs the exact raw bytes; do not parse/serialize before verification.
    if (body.length > 100_000) throw new CheckoutError("Webhook is too large.", 413);
    const event = await verifyStripeWebhook(
      body,
      request.headers.get("stripe-signature"),
      bindings.STRIPE_WEBHOOK_SECRET,
    );
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return Response.json({ received: true });
    }
    if (event.data.object.payment_status !== "paid") {
      // Delayed payment methods are fulfilled only after async_payment_succeeded.
      return Response.json({ received: true });
    }
    const session = checkoutSnapshot(event.data.object);
    const id = event.data.object.id as string;
    const claim = await claimOrder(bindings.CHECKOUT_DB, id);
    if (claim === "created") return Response.json({ received: true });
    let orderId: string;
    try {
      orderId = await createPrintifyOrder(
        { token: bindings.PRINTIFY_API_TOKEN },
        session.shopId,
        id,
        session.items,
        session.address,
        session.shippingMethod,
      );
    } catch (error) {
      return await markOrderUncertain(bindings.CHECKOUT_DB, id, error);
    }
    await markOrderCreated(bindings.CHECKOUT_DB, id, orderId);
    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
};
