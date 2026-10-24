import { CheckoutError } from "../checkout/domain";

export async function verifyPrintifySignature(
  body: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
    throw new CheckoutError("Invalid Printify webhook signature.", 400);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const digest = Uint8Array.from(signature.slice(7).match(/../g)!, (value) => parseInt(value, 16));
  if (!(await crypto.subtle.verify("HMAC", key, digest, new TextEncoder().encode(body))))
    throw new CheckoutError("Invalid Printify webhook signature.", 400);
}

type PublishingConfig = { token: string; shopId: string; origin: string };

export async function handlePublishingEvent(
  config: PublishingConfig,
  event: unknown,
): Promise<void> {
  const data = event as {
    type?: string;
    resource?: {
      id?: string;
      type?: string;
      data?: { shop_id?: number | string; action?: string };
    };
  } | null;
  if (
    !data ||
    typeof data.type !== "string" ||
    data.resource?.type !== "product" ||
    typeof data.resource.id !== "string" ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(data.resource.id)
  )
    throw new CheckoutError("Invalid Printify product event.", 400);
  const resource = data.resource;
  if (resource.data?.shop_id !== undefined && String(resource.data.shop_id) !== config.shopId)
    throw new CheckoutError("Printify event belongs to another shop.", 400);
  if (data.type !== "product:publish:started") return;
  const action = resource.data?.action;
  if (!action || !["create", "update", "delete"].includes(action))
    throw new CheckoutError("Unsupported Printify publishing action.", 400);
  const base = `https://api.printify.com/v1/shops/${config.shopId}/products/${resource.id}`;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "User-Agent": "utxowear-publishing/1.0",
    "Content-Type": "application/json",
  };
  const productResponse = await fetch(`${base}.json`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (productResponse.status === 404) return; // Deleted products cannot be republished by an old delivery.
  if (!productResponse.ok) throw new CheckoutError("Cannot read Printify publishing state.", 503);
  const product = (await productResponse.json()) as {
    id: string;
    is_locked?: boolean;
    images?: unknown[];
    variants?: { is_enabled: boolean; is_available?: boolean; price: number }[];
  };
  if (product.id !== resource.id) throw new CheckoutError("Printify product mismatch.", 503);
  // Only act on a current pending publishing request. Retries after acknowledgement
  // are no-ops, including old create events delivered after an unpublish.
  if (product.is_locked !== true) return;
  let endpoint: string;
  let body: unknown;
  if (action === "delete") {
    endpoint = "unpublish";
  } else if (
    !product.images?.length ||
    !product.variants?.some(
      (v) =>
        v.is_enabled && v.is_available !== false && Number.isSafeInteger(v.price) && v.price > 0,
    )
  ) {
    endpoint = "publishing_failed";
    body = {
      reason: "This product needs a mockup and an available priced variant before publishing.",
    };
  } else {
    endpoint = "publishing_succeeded";
    body = {
      external: { id: resource.id, handle: `${config.origin}/products#product-${resource.id}` },
    };
  }
  const response = await fetch(`${base}/${endpoint}.json`, {
    method: "POST",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new CheckoutError("Printify publishing acknowledgement failed.", 503);
}
