import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { CheckoutError, jsonError, type Quote } from "./domain";
import { createStripeSession } from "./stripe";

const customerValues = {
  name: "Customer Name Sentinel",
  email: "customer-sentinel@example.invalid",
  phone: "+12025550987",
  address: "987 Customer Address Sentinel",
  credential: "sk_test_CredentialSentinel",
  requestBody: "RequestBodySentinel",
};
const confidentialText = Object.values(customerValues).join("; ");
const quote: Quote = {
  shopId: "123",
  currency: "USD",
  address: {
    first_name: customerValues.name,
    last_name: "Customer",
    email: customerValues.email,
    phone: customerValues.phone,
    country: "US",
    region: "CA",
    address1: customerValues.address,
    address2: "",
    city: "Oakland",
    zip: "94612",
  },
  items: [
    {
      productId: "5b05842f3921c9547531758d",
      variantId: 12359,
      quantity: 1,
      title: "Shirt",
      variantTitle: "Blue / Medium",
      price: 1750,
      currency: "USD",
    },
  ],
  subtotal: 1750,
  options: [{ method: 1, label: "Standard", price: 900, currency: "USD" }],
};
const originalFetch = globalThis.fetch;
const consoleError = spyOn(console, "error").mockImplementation(() => {});

afterAll(() => consoleError.mockRestore());

afterEach(() => {
  globalThis.fetch = originalFetch;
  consoleError.mockClear();
});

async function verifyStripeFailure(message: string) {
  let failure: unknown;
  try {
    await createStripeSession(
      customerValues.credential,
      "https://store.example.invalid",
      quote,
      quote.options[0]!,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(CheckoutError);
  const response = jsonError(failure);
  expect(response.status).toBe(503);
  const payload: unknown = await response.json();
  expect(payload).toEqual({ error: message });
  expect(consoleError).toHaveBeenCalledTimes(1);
  const output = Bun.inspect(consoleError.mock.calls);
  for (const value of Object.values(customerValues)) expect(output).not.toContain(value);
  return consoleError.mock.calls[0];
}

test.each(["/customers", "/checkout/sessions"])(
  "retains safe HTTP diagnostics for %s without customer values or provider messages",
  async (operation) => {
    globalThis.fetch = (async (input) => {
      if (!String(input).endsWith(operation)) return Response.json({ id: "cus_Diagnostic" });
      return Response.json(
        {
          error: {
            type: "invalid_request_error",
            code: "email_invalid",
            message: confidentialText,
            param: confidentialText,
            request_log_url: `https://example.invalid/${customerValues.credential}`,
            customer: customerValues,
            request: { body: confidentialText, authorization: customerValues.credential },
          },
          ...customerValues,
        },
        { status: 400, headers: { "Request-Id": "req_Diagnostic123" } },
      );
    }) as typeof fetch;
    expect(await verifyStripeFailure("Payment provider or Stripe Tax is unavailable.")).toEqual([
      "[Checkout] Stripe request failure:",
      {
        operation,
        failure: "http",
        status: 400,
        requestId: "req_Diagnostic123",
        errorType: "invalid_request_error",
        errorCode: "email_invalid",
      },
    ]);
  },
);

test.each([
  ["customer values", confidentialText],
  ["identifier-shaped customer values", "customer_name_sentinel"],
  ["nested objects", customerValues],
  ["arrays", [confidentialText]],
  ["null", null],
])("omits unrecognized diagnostic values: %s", async (_description, value) => {
  globalThis.fetch = (async (_request) =>
    Response.json(
      { error: { type: value, code: value, message: confidentialText } },
      { status: 400, headers: { "Request-Id": customerValues.email } },
    )) as typeof fetch;
  expect(await verifyStripeFailure("Payment provider or Stripe Tax is unavailable.")).toEqual([
    "[Checkout] Stripe request failure:",
    { operation: "/customers", failure: "http", status: 400 },
  ]);
});

test.each([
  ["non-JSON", confidentialText],
  ["malformed JSON", `{"error":{"message":"${confidentialText}"`],
  ["null JSON", "null"],
  ["array JSON", JSON.stringify([customerValues])],
  ["string JSON", JSON.stringify(confidentialText)],
  ["absent error object", JSON.stringify(customerValues)],
  ["string error object", JSON.stringify({ error: confidentialText })],
])("retains HTTP status and request identifier for %s failures", async (_description, body) => {
  globalThis.fetch = (async (_request) =>
    new Response(body, {
      status: 502,
      headers: { "Request-Id": "req_Diagnostic456" },
    })) as typeof fetch;
  expect(await verifyStripeFailure("Payment provider or Stripe Tax is unavailable.")).toEqual([
    "[Checkout] Stripe request failure:",
    {
      operation: "/customers",
      failure: "http",
      status: 502,
      requestId: "req_Diagnostic456",
    },
  ]);
});

test("handles response body read errors without logging their message or cause", async () => {
  globalThis.fetch = (async (_request) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error(confidentialText, { cause: customerValues }));
        },
      }),
      { status: 503, headers: { "Request-Id": "req_Diagnostic789" } },
    )) as typeof fetch;
  expect(await verifyStripeFailure("Payment provider or Stripe Tax is unavailable.")).toEqual([
    "[Checkout] Stripe request failure:",
    {
      operation: "/customers",
      failure: "http",
      status: 503,
      requestId: "req_Diagnostic789",
    },
  ]);
});

test.each(["exception", "object", "string"])(
  "does not log transport %s contents, stack, or cause",
  async (representation) => {
    const failure = new Error(confidentialText, { cause: customerValues });
    failure.name = confidentialText;
    failure.stack = confidentialText;
    globalThis.fetch = (async (_request): Promise<Response> => {
      if (representation === "exception") throw failure;
      if (representation === "object") throw customerValues;
      throw confidentialText;
    }) as typeof fetch;
    expect(await verifyStripeFailure("Payment provider is temporarily unavailable.")).toEqual([
      "[Checkout] Stripe request failure:",
      { operation: "/customers", failure: "transport" },
    ]);
  },
);

test("keeps malformed successful responses generic without logging parser exceptions", async () => {
  globalThis.fetch = (async (_request) => new Response(confidentialText)) as typeof fetch;
  await expect(
    createStripeSession(
      customerValues.credential,
      "https://store.example.invalid",
      quote,
      quote.options[0]!,
    ),
  ).rejects.toThrow("Payment provider returned invalid JSON.");
  expect(consoleError).not.toHaveBeenCalled();
});
