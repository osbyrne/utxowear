import { createFileRoute } from "@tanstack/react-router";
import { jsonError } from "../lib/checkout/domain";
import { fulfillStripeWebhook } from "../lib/checkout/fulfillment";
import { checkoutBindings } from "../lib/checkout/runtime";

const handlePost = async ({ request }: { request: Request }) => {
  try {
    return await fulfillStripeWebhook(request, await checkoutBindings());
  } catch (error) {
    return jsonError(error);
  }
};

export const Route = createFileRoute("/api/stripe-webhook")({
  server: { handlers: { POST: handlePost } },
});
