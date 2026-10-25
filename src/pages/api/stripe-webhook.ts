import type { APIRoute } from "astro";
import { jsonError } from "../../lib/checkout/domain";
import { fulfillStripeWebhook } from "../../lib/checkout/fulfillment";
import { checkoutBindings } from "../../lib/checkout/runtime";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    return await fulfillStripeWebhook(request, await checkoutBindings());
  } catch (error) {
    return jsonError(error);
  }
};
