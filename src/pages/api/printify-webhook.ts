import type { APIRoute } from "astro";
import { CheckoutError, jsonError } from "../../lib/checkout/domain";
import { checkoutBindings } from "../../lib/checkout/runtime";
import { fulfillmentEnvironment } from "../../lib/checkout/environment";
import { invalidatePrintifyCatalog } from "../../lib/printify";
import { handlePublishingEvent, verifyPrintifySignature } from "../../lib/printify/publishing";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const env = await checkoutBindings();
    if (
      !env.PRINTIFY_WEBHOOK_SECRET ||
      !env.PRINTIFY_API_TOKEN ||
      !env.PRINTIFY_SHOP_ID ||
      !env.CHECKOUT_ORIGIN
    )
      throw new CheckoutError("Printify publishing is not configured.", 503);
    const shopId = fulfillmentEnvironment(env).shopId!;
    if (Number(request.headers.get("content-length")) > 100_000)
      throw new CheckoutError("Webhook is too large.", 413);
    const body = await request.text();
    if (body.length > 100_000) throw new CheckoutError("Webhook is too large.", 413);
    await verifyPrintifySignature(
      body,
      request.headers.get("x-pfy-signature"),
      env.PRINTIFY_WEBHOOK_SECRET,
    );
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      throw new CheckoutError("Invalid Printify event JSON.", 400);
    }
    await handlePublishingEvent(
      { token: env.PRINTIFY_API_TOKEN, shopId, origin: env.CHECKOUT_ORIGIN },
      event,
    );
    invalidatePrintifyCatalog();
    return Response.json({ received: true });
  } catch (error) {
    return jsonError(error);
  }
};
