import { afterEach, beforeEach, expect, test } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { configFromEnvironment } from "../printify";
import { fulfillStripeWebhook } from "./fulfillment";
import { createPrintifyOrder, quoteCart } from "./printify";
import { createCheckoutTestDatabase } from "./test-database";
import { requireCheckoutConfig, type CheckoutBindings } from "./runtime";

const originalFetch = globalThis.fetch;
const address = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "+12025550123",
  country: "US",
  region: "CA",
  address1: "10 Main St",
  address2: "",
  city: "Oakland",
  zip: "94612",
};
const item = { productId: "5b05842f3921c9547531758d", variantId: 12359, quantity: 1 };
let sqlite: DatabaseSync;
let bindings: CheckoutBindings;
let requests: string[];

beforeEach(async () => {
  const database = createCheckoutTestDatabase();
  sqlite = database.sqlite;
  const db = database.db;
  bindings = {
    PRINTIFY_SHOP_ID: "123",
    PRINTIFY_TEST_SHOP_ID: "456",
    PRINTIFY_API_TOKEN: "test-token",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    CHECKOUT_ORIGIN: "https://store.example",
    CHECKOUT_DB: db,
  };
  requests = [];
  globalThis.fetch = (async (url) => {
    requests.push(String(url));
    return Response.json(
      String(url).endsWith("/express.json")
        ? { data: [{ type: "order", id: "express_order" }] }
        : { id: "ordinary_order" },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  sqlite.close();
});

type Overrides = {
  event?: Record<string, unknown>;
  session?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

async function webhook(overrides: Overrides = {}, tamper = false): Promise<Request> {
  const session = {
    id: "cs_test_fixture",
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    customer: "cus_fixture",
    amount_subtotal: 2600,
    amount_total: 2600,
    total_details: { amount_tax: 0 },
    automatic_tax: { status: "complete" },
    ...overrides.session,
    metadata: {
      checkout_version: "3",
      currency: "USD",
      customer: "cus_fixture",
      shop: "123",
      cart: JSON.stringify([[item.productId, item.variantId, item.quantity, 1750]]),
      method: "1",
      shipping: "850",
      total: "2600",
      ...Object.fromEntries(Object.entries(address).map(([field, value]) => [`a_${field}`, value])),
      ...overrides.metadata,
    },
  };
  const body = JSON.stringify({
    type: "checkout.session.completed",
    livemode: false,
    data: { object: session },
    ...overrides.event,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("whsec_test"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  ).toString("hex");
  return new Request("https://store.example/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
    body: tamper ? `${body} ` : body,
  });
}

function ledger() {
  return sqlite.prepare("SELECT session_id, status, printify_order_id FROM checkout_orders").all();
}

test("default sandbox mode records simulated fulfillment once, including Express, without Printify credentials or calls", async () => {
  delete bindings.PRINTIFY_API_TOKEN;
  for (let delivery = 0; delivery < 2; delivery++) {
    const response = await fulfillStripeWebhook(
      await webhook({ metadata: { method: "3" } }),
      bindings,
    );
    expect(await response.json()).toMatchObject({ received: true, fulfillment: "simulated" });
  }
  expect(ledger()).toEqual([
    { session_id: "cs_test_fixture", status: "simulated", printify_order_id: null },
  ]);
  expect(requests).toEqual([]);
});

test("signed sandbox events cannot fulfill in production and live events cannot fulfill in sandbox", async () => {
  for (const mode of ["production", "simulate", "test"]) {
    bindings.FULFILLMENT_MODE = mode;
    for (const [eventMode, sessionMode] of [
      [mode !== "production", mode !== "production"],
      [true, false],
      [false, true],
      [undefined, false],
      [false, undefined],
      ["true", true],
    ]) {
      await expect(
        fulfillStripeWebhook(
          await webhook({ event: { livemode: eventMode }, session: { livemode: sessionMode } }),
          bindings,
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
  }
  expect(ledger()).toEqual([]);
  expect(requests).toEqual([]);
});

test("invalid environment settings and wrong shops fail before any ledger or provider write", async () => {
  for (const settings of [
    { FULFILLMENT_MODE: "typo" },
    { FULFILLMENT_MODE: "production", PRINTIFY_SHOP_ID: undefined },
    { FULFILLMENT_MODE: "test", PRINTIFY_TEST_SHOP_ID: undefined },
    { FULFILLMENT_MODE: "test", PRINTIFY_TEST_SHOP_ID: "123" },
    { FULFILLMENT_MODE: "test", PRINTIFY_TEST_SHOP_ID: "0123" },
  ]) {
    await expect(
      fulfillStripeWebhook(await webhook(), { ...bindings, ...settings }),
    ).rejects.toMatchObject({ status: 503 });
  }
  await expect(
    fulfillStripeWebhook(await webhook(), { ...bindings, FULFILLMENT_MODE: "test" }),
  ).rejects.toThrow("different Printify shop");
  await expect(
    fulfillStripeWebhook(
      await webhook({
        event: { livemode: true },
        session: { livemode: true },
        metadata: { shop: "456" },
      }),
      { ...bindings, FULFILLMENT_MODE: "production" },
    ),
  ).rejects.toThrow("different Printify shop");
  expect(ledger()).toEqual([]);
  expect(requests).toEqual([]);
});

test("opted-in sandbox fulfillment targets only the test shop and duplicate deliveries create one order", async () => {
  bindings.FULFILLMENT_MODE = "test";
  for (let delivery = 0; delivery < 2; delivery++)
    expect(
      (await fulfillStripeWebhook(await webhook({ metadata: { shop: "456" } }), bindings)).status,
    ).toBe(200);
  expect(requests).toEqual(["https://api.printify.com/v1/shops/456/orders.json"]);
  expect(ledger()).toEqual([
    { session_id: "cs_test_fixture", status: "created", printify_order_id: "ordinary_order" },
  ]);
});

test("test mode blocks Express at webhook and provider submission, including previously issued sessions", async () => {
  bindings.FULFILLMENT_MODE = "test";
  await expect(
    fulfillStripeWebhook(await webhook({ metadata: { shop: "456", method: "3" } }), bindings),
  ).rejects.toThrow("Express is disabled");
  await expect(
    createPrintifyOrder(
      { token: "test-token", allowExpress: false },
      "456",
      "cs_test_fixture",
      [item],
      address,
      3,
    ),
  ).rejects.toThrow("Express is disabled");
  expect(ledger()).toEqual([]);
  expect(requests).toEqual([]);
});

test("production accepts live paid events, including Express and delayed success, with duplicate protection", async () => {
  bindings.FULFILLMENT_MODE = "production";
  for (const method of [1, 3]) {
    for (let delivery = 0; delivery < 2; delivery++) {
      const response = await fulfillStripeWebhook(
        await webhook({
          event: { livemode: true, type: "checkout.session.async_payment_succeeded" },
          session: { id: `cs_live_fixture_${method}`, livemode: true },
          metadata: { method: String(method) },
        }),
        bindings,
      );
      expect(response.status).toBe(200);
    }
  }
  expect(requests).toEqual([
    "https://api.printify.com/v1/shops/123/orders.json",
    "https://api.printify.com/v1/shops/123/orders/express.json",
  ]);
  expect(ledger()).toHaveLength(2);
});

test("a simulated session cannot be promoted into a physical order by changing environment settings", async () => {
  bindings.PRINTIFY_SHOP_ID = "456";
  await fulfillStripeWebhook(await webhook({ metadata: { shop: "456" } }), bindings);
  bindings.PRINTIFY_SHOP_ID = "123";
  bindings.FULFILLMENT_MODE = "test";
  await expect(
    fulfillStripeWebhook(await webhook({ metadata: { shop: "456" } }), bindings),
  ).rejects.toMatchObject({ status: 409 });
  expect(requests).toEqual([]);
  expect(ledger()[0]).toMatchObject({ status: "simulated", printify_order_id: null });
});

test("tampered signatures and incomplete payments never get fulfillment records", async () => {
  await expect(fulfillStripeWebhook(await webhook({}, true), bindings)).rejects.toThrow(
    "signature",
  );
  expect(
    (await fulfillStripeWebhook(await webhook({ session: { payment_status: "unpaid" } }), bindings))
      .status,
  ).toBe(200);
  expect(ledger()).toEqual([]);
  expect(requests).toEqual([]);
});

test("test checkout and catalog use the separate shop, quotes omit Express, and API key mode is enforced", async () => {
  bindings.FULFILLMENT_MODE = "test";
  const config = requireCheckoutConfig(bindings, new Request("https://store.example/api/checkout"));
  expect(config.shopId).toBe("456");
  expect(configFromEnvironment(bindings).config.shopId).toBe("456");
  globalThis.fetch = (async (url) => {
    requests.push(String(url));
    return Response.json(
      String(url).endsWith("/shipping.json")
        ? { standard: 850, printify_express: 1000 }
        : {
            id: item.productId,
            visible: true,
            external: { id: item.productId },
            variants: [{ id: item.variantId, price: 1750, is_enabled: true }],
          },
    );
  }) as typeof fetch;
  const quote = await quoteCart(config, [item], address);
  expect(quote.options.map((option) => option.method)).toEqual([1]);
  expect(requests.every((url) => url.includes("/shops/456/"))).toBe(true);
  for (const mode of [undefined, "simulate", "test"])
    expect(() =>
      requireCheckoutConfig(
        { ...bindings, FULFILLMENT_MODE: mode, STRIPE_SECRET_KEY: "sk_live_fixture" },
        new Request("https://store.example/api/checkout"),
      ),
    ).toThrow("API key mode");
  expect(() =>
    requireCheckoutConfig(
      { ...bindings, FULFILLMENT_MODE: "production" },
      new Request("https://store.example/api/checkout"),
    ),
  ).toThrow("API key mode");
  expect(
    requireCheckoutConfig(
      { ...bindings, FULFILLMENT_MODE: "production", STRIPE_SECRET_KEY: "rk_live_fixture" },
      new Request("https://store.example/api/checkout"),
    ).shopId,
  ).toBe("123");
});
