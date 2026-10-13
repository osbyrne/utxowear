import {
  CheckoutError,
  type Address,
  type CartItem,
  type Quote,
  type ShippingOption,
  validateAddress,
  validateAmount,
  validateItems,
} from "./domain";

export type CheckoutSnapshot = {
  shopId: string;
  items: CartItem[];
  address: Address;
  shippingMethod: number;
  total: number;
};

type StripeSession = {
  id?: unknown;
  url?: unknown;
  mode?: unknown;
  customer?: unknown;
  payment_status?: unknown;
  status?: unknown;
  amount_total?: unknown;
  amount_subtotal?: unknown;
  total_details?: unknown;
  automatic_tax?: unknown;
  currency?: unknown;
  metadata?: unknown;
};

export function checkoutSnapshot(session: StripeSession): CheckoutSnapshot {
  if (
    typeof session.id !== "string" ||
    !/^cs_[a-zA-Z0-9_]+$/.test(session.id) ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.currency !== "usd" ||
    !validateAmount(session.amount_total) ||
    !session.metadata ||
    typeof session.metadata !== "object"
  ) {
    throw new CheckoutError("Stripe session is not a completed USD payment.", 400);
  }
  const metadata = session.metadata as Record<string, unknown>;
  if (
    metadata.checkout_version !== "2" ||
    typeof metadata.shop !== "string" ||
    !/^\d+$/.test(metadata.shop) ||
    typeof metadata.cart !== "string" ||
    typeof metadata.total !== "string" ||
    typeof metadata.shipping !== "string" ||
    typeof metadata.method !== "string" ||
    typeof metadata.customer !== "string" ||
    session.customer !== metadata.customer
  ) {
    throw new CheckoutError("Missing trusted checkout snapshot.", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata.cart);
  } catch {
    throw new CheckoutError("Invalid checkout snapshot.", 400);
  }
  if (!Array.isArray(parsed)) throw new CheckoutError("Invalid checkout cart snapshot.", 400);
  const rows: unknown[] = [];
  let subtotal = 0;
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 4 || !validateAmount(row[3]) || row[3] === 0)
      throw new CheckoutError("Invalid paid cart line.", 400);
    rows.push({ productId: row[0], variantId: row[1], quantity: row[2] });
    subtotal += row[3] * row[2];
  }
  const items = validateItems(rows);
  const addressInput: Record<string, unknown> = {};
  for (const field of [
    "first_name",
    "last_name",
    "email",
    "phone",
    "country",
    "region",
    "address1",
    "address2",
    "city",
    "zip",
  ]) {
    addressInput[field] = metadata[`a_${field}`];
  }
  const address = validateAddress(addressInput);
  const shipping = Number(metadata.shipping);
  const method = Number(metadata.method);
  const total = Number(metadata.total);
  const tax = (session.total_details as { amount_tax?: unknown } | null)?.amount_tax;
  const taxStatus = (session.automatic_tax as { status?: unknown } | null)?.status;
  if (
    !validateAmount(shipping) ||
    ![1, 2, 3, 4].includes(method) ||
    !validateAmount(total) ||
    !validateAmount(tax) ||
    taxStatus !== "complete" ||
    subtotal + shipping !== total ||
    session.amount_subtotal !== total ||
    total + tax !== session.amount_total ||
    total === 0
  ) {
    throw new CheckoutError("Stripe payment does not match its checkout snapshot.", 400);
  }
  return { shopId: metadata.shop, items, address, shippingMethod: method, total };
}

export async function createStripeSession(
  secret: string,
  origin: string,
  quote: Quote,
  option: ShippingOption,
): Promise<string> {
  const total = quote.subtotal + option.price;
  if (!validateAmount(total) || total === 0) throw new CheckoutError("Cart total is too large.");
  // Metadata has a 500-character limit per value. Keep cart compact, store address in separate fields.
  const cart = JSON.stringify(
    quote.items.map((item) => [item.productId, item.variantId, item.quantity, item.price]),
  );
  if (cart.length > 500)
    throw new CheckoutError("Too many variants for a single checkout. Please split your cart.");
  const customer = new URLSearchParams({
    email: quote.address.email,
    name: `${quote.address.first_name} ${quote.address.last_name}`,
    phone: quote.address.phone,
    "shipping[name]": `${quote.address.first_name} ${quote.address.last_name}`,
    "shipping[phone]": quote.address.phone,
    "shipping[address][country]": quote.address.country,
    "shipping[address][state]": quote.address.region,
    "shipping[address][line1]": quote.address.address1,
    "shipping[address][line2]": quote.address.address2,
    "shipping[address][city]": quote.address.city,
    "shipping[address][postal_code]": quote.address.zip,
  });
  const customerResult = await stripePost(secret, "/customers", customer);
  if (typeof customerResult.id !== "string" || !customerResult.id.startsWith("cus_")) {
    throw new CheckoutError("Payment provider returned an invalid customer.", 503);
  }
  const params = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    customer: customerResult.id,
    "automatic_tax[enabled]": "true",
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout=cancel`,
    "metadata[checkout_version]": "2",
    "metadata[customer]": customerResult.id,
    "metadata[shop]": quote.shopId,
    "metadata[cart]": cart,
    "metadata[method]": String(option.method),
    "metadata[shipping]": String(option.price),
    "metadata[total]": String(total),
  });
  for (const [field, value] of Object.entries(quote.address))
    params.set(`metadata[a_${field}]`, value);
  quote.items.forEach((item, index) => {
    params.set(`line_items[${index}][price_data][currency]`, "usd");
    params.set(`line_items[${index}][price_data][unit_amount]`, String(item.price));
    params.set(`line_items[${index}][price_data][tax_behavior]`, "exclusive");
    params.set(
      `line_items[${index}][price_data][product_data][name]`,
      `${item.title} — ${item.variantTitle}`.slice(0, 250),
    );
    params.set(`line_items[${index}][quantity]`, String(item.quantity));
  });
  const shippingIndex = quote.items.length;
  params.set(`line_items[${shippingIndex}][price_data][currency]`, "usd");
  params.set(`line_items[${shippingIndex}][price_data][unit_amount]`, String(option.price));
  params.set(`line_items[${shippingIndex}][price_data][tax_behavior]`, "exclusive");
  params.set(`line_items[${shippingIndex}][price_data][product_data][tax_code]`, "txcd_92010001");
  params.set(
    `line_items[${shippingIndex}][price_data][product_data][name]`,
    `Shipping — ${option.label}`,
  );
  params.set(`line_items[${shippingIndex}][quantity]`, "1");
  const session = (await stripePost(secret, "/checkout/sessions", params)) as StripeSession;
  if (
    typeof session.id !== "string" ||
    !session.id.startsWith("cs_") ||
    typeof session.url !== "string" ||
    (session.automatic_tax as { enabled?: unknown } | null)?.enabled !== true ||
    (session.automatic_tax as { status?: unknown } | null)?.status === "failed"
  ) {
    throw new CheckoutError("Payment provider or Stripe Tax returned an invalid session.", 503);
  }
  let url: URL;
  try {
    url = new URL(session.url);
  } catch {
    throw new CheckoutError("Payment provider returned an invalid URL.", 503);
  }
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
    throw new CheckoutError("Payment provider returned an invalid URL.", 503);
  return session.url;
}

async function stripePost(
  secret: string,
  path: string,
  params: URLSearchParams,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    console.error(`[Checkout] Stripe ${path} request failed:`, error);
    throw new CheckoutError("Payment provider is temporarily unavailable.", 503);
  }
  if (!response.ok) {
    console.error(
      `[Checkout] Stripe ${path} returned HTTP ${response.status}:`,
      (await response.text()).slice(0, 1000),
    );
    throw new CheckoutError("Payment provider or Stripe Tax is unavailable.", 503);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CheckoutError("Payment provider returned invalid JSON.", 503);
  }
}

export async function verifyStripeWebhook(
  body: string,
  signature: string | null,
  secret: string,
): Promise<{ type: string; data: { object: StripeSession } }> {
  const parts = signature?.split(",").map((part) => part.trim()) ?? [];
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const now = Math.floor(Date.now() / 1000);
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300 ||
    !signatures.length
  ) {
    throw new CheckoutError("Invalid Stripe webhook signature.", 400);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  let verified = false;
  for (const signatureHex of signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signatureHex)) continue;
    let mismatch = 0;
    for (let index = 0; index < digest.length; index += 1)
      mismatch |= digest[index] ^ Number.parseInt(signatureHex.slice(index * 2, index * 2 + 2), 16);
    verified ||= mismatch === 0;
  }
  if (!verified) throw new CheckoutError("Invalid Stripe webhook signature.", 400);
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    throw new CheckoutError("Invalid Stripe webhook JSON.", 400);
  }
  if (
    !event ||
    typeof event !== "object" ||
    typeof (event as { type?: unknown }).type !== "string" ||
    !(
      (event as { data?: unknown }).data && typeof (event as { data?: unknown }).data === "object"
    ) ||
    !(
      (event as { data: { object?: unknown } }).data.object &&
      typeof (event as { data: { object?: unknown } }).data.object === "object"
    )
  ) {
    throw new CheckoutError("Invalid Stripe webhook event.", 400);
  }
  return event as { type: string; data: { object: StripeSession } };
}
