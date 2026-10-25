import { CheckoutError } from "./domain";
import { fulfillmentEnvironment, requireStripeEventMode } from "./environment";
import { claimOrder, markOrderCreated, markOrderUncertain, recordSimulatedOrder } from "./orders";
import { createPrintifyOrder } from "./printify";
import type { CheckoutBindings } from "./runtime";
import { checkoutSnapshot, verifyStripeWebhook } from "./stripe";

export async function fulfillStripeWebhook(
  request: Request,
  bindings: CheckoutBindings,
): Promise<Response> {
  if (!bindings.STRIPE_WEBHOOK_SECRET || !bindings.CHECKOUT_DB)
    throw new CheckoutError("Webhook fulfillment is not configured.", 503);
  if (Number(request.headers.get("content-length")) > 100_000)
    throw new CheckoutError("Webhook is too large.", 413);
  const body = await request.text(); // Verify the exact raw signed body before inspecting the mode.
  if (body.length > 100_000) throw new CheckoutError("Webhook is too large.", 413);
  const event = await verifyStripeWebhook(
    body,
    request.headers.get("stripe-signature"),
    bindings.STRIPE_WEBHOOK_SECRET,
  );
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  )
    return Response.json({ received: true });
  const environment = fulfillmentEnvironment(bindings);
  requireStripeEventMode(environment, event.livemode, event.data.object.livemode);
  if (event.data.object.payment_status !== "paid") return Response.json({ received: true });
  const session = checkoutSnapshot(event.data.object);
  if (environment.shopId && session.shopId !== environment.shopId)
    throw new CheckoutError("Stripe checkout belongs to a different Printify shop.", 400);
  const id = event.data.object.id as string;
  if (environment.mode === "simulate") {
    await recordSimulatedOrder(bindings.CHECKOUT_DB, id);
    return Response.json({ received: true, fulfillment: "simulated" });
  }
  if (environment.mode === "test" && session.shippingMethod === 3)
    throw new CheckoutError("Printify Express is disabled for fulfillment tests.", 400);
  if (!bindings.PRINTIFY_API_TOKEN)
    throw new CheckoutError("Printify fulfillment is not configured.", 503);
  const claim = await claimOrder(bindings.CHECKOUT_DB, id);
  if (claim === "created") return Response.json({ received: true });
  let orderId: string;
  try {
    orderId = await createPrintifyOrder(
      { token: bindings.PRINTIFY_API_TOKEN, allowExpress: environment.mode === "production" },
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
}
