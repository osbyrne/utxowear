import { afterEach, describe, expect, test } from "bun:test";
import { parseCheckoutRequest, type Address, type Quote } from "./domain";
import { usdPricing } from "../pricing";
import { requireCheckoutConfig } from "./runtime";
import { claimOrder, markOrderCreated, markOrderUncertain, type CheckoutDatabase } from "./orders";
import { quoteCart, shippingOptions, createPrintifyOrder } from "./printify";
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

describe("Printify quote and order selection", () => {
  test("converts authenticated USD retail prices and unlabelled USD shipping into EUR", async () => {
    globalThis.fetch = (async (input) =>
      String(input).includes("/products/")
        ? Response.json({
            id: item.productId,
            title: "Tee",
            visible: true,
            variants: [{ id: item.variantId, price: 1751, is_enabled: true }],
          })
        : Response.json({ standard: 1039, priority: 2001 })) as typeof fetch;
    // Synthetic merchant rate for deterministic testing, not a real exchange rate.
    const quote = await quoteCart(
      { token: "secret", shopId: "123", currency: "EUR", usdToEurRate: "0.8" },
      [item],
      address,
    );
    expect(quote.currency).toBe("EUR");
    expect(quote.items[0]).toMatchObject({ price: 1401, currency: "EUR" });
    expect(quote.subtotal).toBe(2802);
    expect(quote.options).toEqual([
      { method: 1, label: "Standard", price: 831, currency: "EUR" },
      { method: 2, label: "Priority", price: 1601, currency: "EUR" },
    ]);
    expect(
      shippingOptions(
        { currency: "USD", standard: 1039 },
        usdPricing({ currency: "EUR", usdToEurRate: "0.8" }),
      )[0]?.price,
    ).toBe(831);
    expect(() => shippingOptions({ currency: "EUR", standard: 1039 })).toThrow("currency");
  });

  test("rejects missing conversion configuration before any upstream request", async () => {
    let called = false;
    globalThis.fetch = (async (_input): Promise<Response> => {
      called = true;
      throw new Error("Unexpected request");
    }) as typeof fetch;
    await expect(quoteCart({ token: "secret", currency: "EUR" }, [item], address)).rejects.toThrow(
      "PRINTIFY_USD_TO_EUR_RATE",
    );
    await expect(quoteCart({ token: "secret", currency: "GBP" }, [item], address)).rejects.toThrow(
      "USD and EUR",
    );
    expect(called).toBe(false);
  });

  test.each(["product", "variant"])(
    "rejects an explicit mismatched %s source currency",
    async (level) => {
      globalThis.fetch = (async (_input) =>
        Response.json({
          id: item.productId,
          title: "Tee",
          visible: true,
          ...(level === "product" ? { currency: "EUR" } : {}),
          variants: [
            {
              id: item.variantId,
              price: 1750,
              is_enabled: true,
              ...(level === "variant" ? { currency: "EUR" } : {}),
            },
          ],
        })) as typeof fetch;
      await expect(quoteCart({ token: "secret", shopId: "123" }, [item], address)).rejects.toThrow(
        "currency",
      );
    },
  );

  test("uses authenticated enabled variant retail price and maps legacy priority without duplicate express", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      calls.push(String(input));
      expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
      if (String(input).includes("/products/"))
        return Response.json({
          id: item.productId,
          title: "Tee",
          visible: true,
          variants: [{ id: 12359, title: "Blue / M", price: 1750, is_enabled: true }],
        });
      return Response.json({ standard: 900, express: 2200, printify_express: 2700, economy: 400 });
    }) as typeof fetch;
    const quote = await quoteCart({ token: "secret", shopId: "123" }, [item], address);
    expect(quote.subtotal).toBe(3500);
    expect(quote.items[0]).toMatchObject({ title: "Tee", variantTitle: "Blue / M", price: 1750 });
    expect(quote.options).toEqual([
      { method: 1, label: "Standard", price: 900, currency: "USD" },
      { method: 2, label: "Priority", price: 2200, currency: "USD" },
      { method: 3, label: "Printify Express", price: 2700, currency: "USD" },
      { method: 4, label: "Economy", price: 400, currency: "USD" },
    ]);
    expect(calls).toHaveLength(2);
    expect(shippingOptions({ priority: 2400, express: 2200 })).toEqual([
      { method: 2, label: "Priority", price: 2400, currency: "USD" },
    ]);
  });

  test("rejects hidden and disabled products before asking Printify for shipping", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      calls.push(String(input));
      return Response.json({
        id: item.productId,
        title: "Tee",
        visible: false,
        variants: [{ id: 12359, price: 1750, is_enabled: true }],
      });
    }) as typeof fetch;
    await expect(quoteCart({ token: "secret", shopId: "123" }, [item], address)).rejects.toThrow(
      "no longer available",
    );
    expect(calls).toHaveLength(1);
    globalThis.fetch = (async (_input, _init) =>
      Response.json({
        id: item.productId,
        title: "Tee",
        visible: true,
        variants: [{ id: 12359, price: 1750, is_enabled: false }],
      })) as typeof fetch;
    await expect(quoteCart({ token: "secret", shopId: "123" }, [item], address)).rejects.toThrow(
      "variant is no longer available",
    );
  });

  test("uses express order API and saves every split order ID", async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toEndWith("/orders/express.json");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        external_id: "cs_test_123",
        shipping_method: 3,
        line_items: [{ product_id: item.productId, variant_id: item.variantId, quantity: 2 }],
      });
      return Response.json({
        data: [
          { type: "order", id: "first" },
          { type: "order", id: "second" },
        ],
      });
    }) as typeof fetch;
    expect(
      await createPrintifyOrder({ token: "secret" }, "123", "cs_test_123", [item], address, 3),
    ).toBe('["first","second"]');
  });
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
      expect(checkoutParams?.has("payment_method_types[0]")).toBe(false);
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

  test("rejects mixed item and shipping currencies before creating a Stripe customer", async () => {
    let called = false;
    globalThis.fetch = (async (_input): Promise<Response> => {
      called = true;
      throw new Error("Unexpected request");
    }) as typeof fetch;
    await expect(
      createStripeSession(
        "sk_test",
        "https://shop.example",
        {
          ...baseQuote,
          items: baseQuote.items.map((item) => ({ ...item, currency: "EUR" })),
        },
        baseQuote.options[0]!,
      ),
    ).rejects.toThrow("currency");
    await expect(
      createStripeSession("sk_test", "https://shop.example", baseQuote, {
        ...baseQuote.options[0]!,
        currency: "EUR",
      }),
    ).rejects.toThrow("currency");
    expect(called).toBe(false);
  });

  test("rejects a modified webhook even when its JSON remains valid", async () => {
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123" } },
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`)),
    );
    const signature = `t=${timestamp},v1=${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    expect((await verifyStripeWebhook(raw, signature, secret)).type).toBe(
      "checkout.session.completed",
    );
    await expect(
      verifyStripeWebhook(raw.replace("completed", "expired"), signature, secret),
    ).rejects.toThrow("signature");
  });
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

describe("checkout request currency and configuration", () => {
  const request = (extra: Record<string, unknown>) =>
    new Request("https://shop.example/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [item], address, ...extra }),
    });
  test("requires an explicit supported client currency and quoted integer total", async () => {
    await expect(parseCheckoutRequest(request({}))).rejects.toThrow("currency");
    await expect(parseCheckoutRequest(request({ currency: "GBP" }))).rejects.toThrow("currency");
    await expect(
      parseCheckoutRequest(request({ currency: "EUR", shippingMethod: 1 }), true),
    ).rejects.toThrow("quoted");
    expect(
      await parseCheckoutRequest(
        request({ currency: "EUR", shippingMethod: 1, expectedTotal: 3520 }),
        true,
      ),
    ).toMatchObject({ currency: "EUR", expectedTotal: 3520 });
  });
  test("EUR support keeps the missing payment setup guard", () => {
    expect(() =>
      requireCheckoutConfig(
        { PRINTIFY_API_TOKEN: "test", PRINTIFY_CURRENCY: "EUR", PRINTIFY_USD_TO_EUR_RATE: "0.8" },
        request({}),
      ),
    ).toThrow("until payment and fulfillment are configured");
  });
});

describe("D1 fulfillment state", () => {
  test("concurrent claims create once; uncertain outcome is never automatically retried", async () => {
    const rows = new Map<string, { status: string; printify_order_id: string | null }>();
    const db: CheckoutDatabase = {
      prepare(query) {
        return {
          bind(...values) {
            return {
              async run() {
                const id = query.startsWith("INSERT")
                  ? values[0]
                  : query.includes("printify_order_id = ?")
                    ? values[2]
                    : values[1];
                const row = rows.get(id!);
                if (query.startsWith("INSERT")) {
                  if (!row) rows.set(id!, { status: "pending", printify_order_id: null });
                  return { meta: { changes: row ? 0 : 1 } };
                }
                if (
                  !row ||
                  row.status !== (query.includes("status = 'pending'") ? "pending" : "submitting")
                )
                  return { meta: { changes: 0 } };
                row.status = query.includes("status = 'pending'")
                  ? "submitting"
                  : query.includes("status = 'uncertain'")
                    ? "uncertain"
                    : "created";
                if (query.includes("printify_order_id = ?")) row.printify_order_id = values[0];
                return { meta: { changes: 1 } };
              },
              async first<T>() {
                return (rows.get(values[0]!) as T) ?? null;
              },
            };
          },
        };
      },
    };
    const results = await Promise.allSettled([
      claimOrder(db, "cs_test_1"),
      claimOrder(db, "cs_test_1"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rows.get("cs_test_1")?.status).toBe("submitting");
    await expect(markOrderUncertain(db, "cs_test_1", new Error("timeout"))).rejects.toThrow(
      "manual reconciliation",
    );
    await expect(claimOrder(db, "cs_test_1")).rejects.toThrow("manual reconciliation");
    rows.get("cs_test_1")!.status = "pending"; // Operator has confirmed Printify has no order.
    expect(await claimOrder(db, "cs_test_1")).toBe("claimed");
    await markOrderCreated(db, "cs_test_1", "printify_1");
    expect(await claimOrder(db, "cs_test_1")).toBe("created");
  });
});
