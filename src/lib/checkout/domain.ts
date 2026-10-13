export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type CartItem = { productId: string; variantId: number; quantity: number };
export type Address = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  region: string;
  address1: string;
  address2: string;
  city: string;
  zip: string;
};
export type CheckoutInput = { items: CartItem[]; address: Address; shippingMethod?: number };
export type PricedItem = CartItem & { price: number; title: string; variantTitle: string };
export type ShippingOption = { method: number; label: string; price: number };
export type Quote = {
  shopId: string;
  items: PricedItem[];
  address: Address;
  options: ShippingOption[];
  subtotal: number;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validateAddress(value: unknown): Address {
  if (!object(value)) throw new CheckoutError("A shipping address is required.");
  const address = {} as Address;
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
  ] as const) {
    const input = value[field];
    if (typeof input !== "string" || input.length > 200)
      throw new CheckoutError(`Invalid address field: ${field}.`);
    address[field] = input.trim();
  }
  for (const field of [
    "first_name",
    "last_name",
    "email",
    "phone",
    "country",
    "address1",
    "city",
    "zip",
  ] as const) {
    if (!address[field]) throw new CheckoutError(`Missing address field: ${field}.`);
  }
  address.country = address.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(address.country) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
    throw new CheckoutError("Invalid shipping country or email.");
  }
  return address;
}

export function validateItems(value: unknown): CartItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 12)
    throw new CheckoutError("Cart must have 1–12 items.");
  const items: CartItem[] = [];
  const seen = new Set<string>();
  let totalQuantity = 0;
  for (const input of value) {
    if (
      !object(input) ||
      typeof input.productId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,80}$/.test(input.productId) ||
      !Number.isSafeInteger(input.variantId) ||
      (input.variantId as number) <= 0 ||
      !Number.isSafeInteger(input.quantity) ||
      (input.quantity as number) < 1 ||
      (input.quantity as number) > 20
    ) {
      throw new CheckoutError("Invalid cart item.");
    }
    const item = {
      productId: input.productId,
      variantId: input.variantId as number,
      quantity: input.quantity as number,
    };
    const key = `${item.productId}:${item.variantId}`;
    if (seen.has(key)) throw new CheckoutError("Duplicate cart variant.");
    seen.add(key);
    totalQuantity += item.quantity;
    items.push(item);
  }
  if (totalQuantity > 50) throw new CheckoutError("Cart quantity exceeds 50.");
  return items;
}

export async function parseCheckoutRequest(
  request: Request,
  withShippingMethod = false,
): Promise<CheckoutInput> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new CheckoutError("Expected JSON request.", 415);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new CheckoutError("Cross-origin checkout is not allowed.", 403);
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 16_384)
    throw new CheckoutError("Request is too large.", 413);
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) throw new CheckoutError("Request is too large.", 413);
    payload = JSON.parse(raw);
  } catch (error) {
    if (error instanceof CheckoutError) throw error;
    throw new CheckoutError("Invalid JSON request.");
  }
  if (!object(payload)) throw new CheckoutError("Invalid checkout request.");
  const items = validateItems(payload.items);
  const address = validateAddress(payload.address);
  if (withShippingMethod && ![1, 2, 3, 4].includes(payload.shippingMethod as number)) {
    throw new CheckoutError("Select a valid shipping method.");
  }
  return {
    items,
    address,
    ...(withShippingMethod ? { shippingMethod: payload.shippingMethod as number } : {}),
  };
}

export function jsonError(error: unknown): Response {
  if (!(error instanceof CheckoutError)) console.error("[Checkout] Unexpected API failure:", error);
  const status = error instanceof CheckoutError ? error.status : 503;
  return Response.json(
    {
      error:
        error instanceof CheckoutError ? error.message : "Checkout is temporarily unavailable.",
    },
    { status },
  );
}

export function validateAmount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 99_999_999;
}
