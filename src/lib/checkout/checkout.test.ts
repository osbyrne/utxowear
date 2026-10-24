import { afterEach, describe, expect, test } from "bun:test";
import { type Address, type Quote } from "./domain";
import { Database } from "bun:sqlite";
import { usdPricing } from "../pricing";
import { claimOrder, markOrderCreated, markOrderUncertain, type CheckoutDatabase } from "./orders";
import { quoteCart } from "./printify";
import { checkoutSnapshot, createStripeSession, verifyStripeWebhook } from "./stripe";

const address: Address = {
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
const item = { productId: "5b05842f3921c9547531758d", variantId: 12359, quantity: 2 };
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("rejects a visible draft before requesting shipping or starting payment", async () => {
  let calls = 0;
  globalThis.fetch = (async (_input) => {
    calls++;
    return Response.json({
      id: item.productId,
      visible: true,
      external: { id: "" },
      variants: [{ id: item.variantId, price: 1750, is_enabled: true }],
    });
  }) as typeof fetch;
  await expect(quoteCart({ token: "secret", shopId: "123" }, [item], address)).rejects.toThrow(
    "no longer available",
  );
  expect(calls).toBe(1);
});

describe("Stripe tax and signed paid checkout", () => {
  const baseQuote: Quote = {
    shopId: "123",
    currency: "USD",
    address,
    items: [{ ...item, title: "Tee", variantTitle: "Blue / M", price: 1750, currency: "USD" }],
    subtotal: 3500,
    options: [{ method: 1, label: "Standard", price: 900, currency: "USD" }],
  };

  test.each(["USD", "EUR"] as const)(
    "creates %s sessions and validates signed currency, shipping, and tax",
    async (currency) => {
      const pricing = usdPricing({ currency, usdToEurRate: "0.8" });
      const quote: Quote = {
        ...baseQuote,
        currency,
        items: baseQuote.items.map((item) => ({
          ...item,
          currency,
          price: pricing.convert(item.price),
        })),
        subtotal: pricing.convert(1750) * 2,
        options: baseQuote.options.map((option) => ({
          ...option,
          currency,
          price: pricing.convert(option.price),
        })),
      };
      let customerParams: URLSearchParams | undefined;
      let checkoutParams: URLSearchParams | undefined;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith("/customers")) {
          customerParams = new URLSearchParams(String(init?.body));
          return Response.json({ id: "cus_test" });
        }
        checkoutParams = new URLSearchParams(String(init?.body));
        return Response.json({
          id: "cs_test_123",
          currency: currency.toLowerCase(),
          url: "https://checkout.stripe.com/c/pay/test",
          automatic_tax: { enabled: true, status: "complete" },
        });
      }) as typeof fetch;
      const url = await createStripeSession(
        "sk_test",
        "https://shop.example",
        quote,
        quote.options[0],
      );
      expect(url).toStartWith("https://checkout.stripe.com/");
      expect(customerParams?.get("shipping[address][postal_code]")).toBe("94612");
      expect(checkoutParams?.get("customer")).toBe("cus_test");
      expect(checkoutParams?.get("automatic_tax[enabled]")).toBe("true");
      expect(checkoutParams?.get("line_items[0][price_data][unit_amount]")).toBe(
        String(pricing.convert(1750)),
      );
      expect(checkoutParams?.get("line_items[0][price_data][currency]")).toBe(
        currency.toLowerCase(),
      );
      expect(checkoutParams?.get("line_items[1][price_data][currency]")).toBe(
        currency.toLowerCase(),
      );
      expect(checkoutParams?.get("line_items[1][price_data][product_data][tax_code]")).toBe(
        "txcd_92010001",
      );
      const metadata = Object.fromEntries(
        [...checkoutParams!.entries()]
          .filter(([key]) => key.startsWith("metadata["))
          .map(([key, value]) => [key.slice(9, -1), value]),
      );
      const session = {
        id: "cs_test_123",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        currency: currency.toLowerCase(),
        customer: "cus_test",
        amount_subtotal: quote.subtotal + quote.options[0]!.price,
        amount_total: quote.subtotal + quote.options[0]!.price + 420,
        total_details: { amount_tax: 420 },
        automatic_tax: { status: "complete" },
        metadata,
      };
      expect(checkoutSnapshot(session)).toMatchObject({
        shippingMethod: 1,
        total: session.amount_subtotal,
        currency,
        items: [item],
      });
      expect(() => checkoutSnapshot({ ...session, amount_total: 4401 })).toThrow("does not match");
      expect(() => checkoutSnapshot({ ...session, payment_status: "unpaid" })).toThrow(
        "not a completed supported payment",
      );
      expect(() => checkoutSnapshot({ ...session, automatic_tax: { status: "failed" } })).toThrow(
        "does not match",
      );
      expect(() =>
        checkoutSnapshot({ ...session, currency: currency === "USD" ? "eur" : "usd" }),
      ).toThrow("currency");
      expect(() =>
        checkoutSnapshot({ ...session, metadata: { ...metadata, currency: "GBP" } }),
      ).toThrow("currency");
      expect(() =>
        checkoutSnapshot({ ...session, metadata: { ...metadata, currency: undefined } }),
      ).toThrow("currency");
      expect(() =>
        checkoutSnapshot({ ...session, metadata: { ...metadata, shipping: "1" } }),
      ).toThrow("does not match");
      expect(() => checkoutSnapshot({ ...session, customer: "cus_other" })).toThrow("snapshot");
      const legacyMetadata: Record<string, string> = { ...metadata, checkout_version: "2" };
      delete legacyMetadata.currency;
      if (currency === "USD")
        expect(checkoutSnapshot({ ...session, metadata: legacyMetadata }).currency).toBe("USD");
      else
        expect(() => checkoutSnapshot({ ...session, metadata: legacyMetadata })).toThrow(
          "currency",
        );
      const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
      const event = await verifyStripeWebhook(raw, await signWebhook(raw), "whsec_test");
      expect(checkoutSnapshot(event.data.object).currency).toBe(currency);
      await expect(
        verifyStripeWebhook(
          raw.replace(`"currency":"${session.currency}"`, '"currency":"gbp"'),
          await signWebhook(raw),
          "whsec_test",
        ),
      ).rejects.toThrow("signature");
    },
  );
});

async function signWebhook(raw: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("whsec_test"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`)),
  );
  return `t=${timestamp},v1=${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("fulfillment claims execute actual SQL: concurrent delivery creates once and uncertainty blocks retries", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    await Bun.file(new URL("../../../migrations/0001_checkout_orders.sql", import.meta.url)).text(),
  );
  const db: CheckoutDatabase = {
    prepare(query) {
      return {
        bind(...values) {
          return {
            async run() {
              return { meta: { changes: sqlite.query(query).run(...values).changes } };
            },
            async first<T>() {
              return sqlite.query(query).get(...values) as T | null;
            },
          };
        },
      };
    },
  };
  try {
    const claims = await Promise.allSettled([claimOrder(db, "cs_once"), claimOrder(db, "cs_once")]);
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await markOrderCreated(db, "cs_once", "printify_order");
    expect(await claimOrder(db, "cs_once")).toBe("created");
    expect(
      sqlite
        .query("SELECT COUNT(*) AS count FROM checkout_orders WHERE session_id = ?")
        .get("cs_once"),
    ).toEqual({ count: 1 });
    await claimOrder(db, "cs_uncertain");
    await expect(
      markOrderUncertain(db, "cs_uncertain", new Error("Printify timeout")),
    ).rejects.toThrow("manual reconciliation");
    await expect(claimOrder(db, "cs_uncertain")).rejects.toThrow("manual reconciliation");
  } finally {
    sqlite.close();
  }
});
