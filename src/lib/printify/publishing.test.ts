import { afterEach, expect, test } from "bun:test";
import { handlePublishingEvent, verifyPrintifySignature } from "./publishing";
import { isPublished } from "./publication";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const config = { token: "test-token", shopId: "123", origin: "https://store.example" };
const event = (action: string, shop_id?: number) => ({
  type: "product:publish:started",
  resource: {
    id: "product123",
    type: "product",
    data: { action, ...(shop_id ? { shop_id } : {}) },
  },
});

test("Printify payload tampering and cross-shop events are rejected before publication", async () => {
  const raw = JSON.stringify(event("create", 123));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = `sha256=${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))).toString("hex")}`;
  await verifyPrintifySignature(raw, sig, "test-secret");
  await expect(verifyPrintifySignature(raw + " ", sig, "test-secret")).rejects.toThrow("signature");
  await expect(verifyPrintifySignature(raw, null, "test-secret")).rejects.toThrow("signature");
  await expect(handlePublishingEvent(config, event("create", 456))).rejects.toThrow("another shop");
});

test("publish and unpublish change catalog eligibility; replaying a completed request cannot republish a draft", async () => {
  const product = {
    id: "product123",
    visible: true,
    is_locked: true,
    external: { id: "" },
    images: [{}],
    variants: [{ is_enabled: true, price: 1200 }],
  };
  let acknowledgements = 0;
  globalThis.fetch = (async (url, init) => {
    if (!init?.method) return Response.json(product);
    acknowledgements++;
    if (String(url).endsWith("/publishing_succeeded.json"))
      product.external = JSON.parse(String(init.body)).external;
    else if (String(url).endsWith("/unpublish.json")) product.external = { id: "" };
    else throw new Error("Unexpected publication operation");
    product.is_locked = false;
    return Response.json({});
  }) as typeof fetch;
  expect(isPublished(product)).toBe(false);
  await handlePublishingEvent(config, event("create", 123));
  expect(isPublished(product)).toBe(true);
  product.is_locked = true;
  await handlePublishingEvent(config, event("delete")); // Printify omits shop_id on this event.
  expect(isPublished(product)).toBe(false);
  await handlePublishingEvent(config, event("create", 123));
  expect(isPublished(product)).toBe(false);
  expect(acknowledgements).toBe(2);
});
