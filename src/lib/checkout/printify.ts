import { isPublished } from "../printify/publication";
import {
  CheckoutError,
  type Address,
  type CartItem,
  type PricedItem,
  type Quote,
  type ShippingOption,
  validateAmount,
} from "./domain";
import { usdPricing, type PricingConfig } from "../pricing";

const BASE = "https://api.printify.com/v1";

type PrintifyConfig = PricingConfig & { token: string; shopId?: string; allowExpress?: boolean };

type Product = {
  id: string;
  title: string;
  visible: boolean;
  external?: { id?: string };
  currency?: unknown;
  variants: {
    id: number;
    title?: string;
    price: number;
    currency?: unknown;
    is_enabled: boolean;
    is_available?: boolean;
  }[];
};

async function printifyRequest(
  config: PrintifyConfig,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "User-Agent": "utxowear-checkout/1.0",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new CheckoutError("Printify could not be reached.", 503);
  }
  if (!response.ok) {
    if (response.status === 404 && method === "GET" && path.includes("/products/"))
      throw new CheckoutError("A product is no longer available.", 400);
    console.error(`[Checkout] Printify ${method} ${path} returned HTTP ${response.status}.`);
    throw new CheckoutError("Printify is temporarily unavailable.", 503);
  }
  try {
    return await response.json();
  } catch {
    throw new CheckoutError("Printify returned an invalid response.", 503);
  }
}

export async function resolveShop(config: PrintifyConfig): Promise<string> {
  if (config.shopId) {
    if (!/^\d+$/.test(config.shopId))
      throw new CheckoutError("Invalid Printify shop configuration.", 503);
    return config.shopId;
  }
  const shops = await printifyRequest(config, "/shops.json");
  if (!Array.isArray(shops) || shops.length !== 1 || !Number.isSafeInteger(shops[0]?.id)) {
    throw new CheckoutError("Set PRINTIFY_SHOP_ID to select the checkout shop.", 503);
  }
  return String(shops[0].id);
}

export function shippingOptions(result: unknown, pricing = usdPricing({})): ShippingOption[] {
  if (typeof result !== "object" || result === null || Array.isArray(result))
    throw new CheckoutError("Invalid shipping quote from Printify.", 503);
  const data = result as Record<string, unknown>;
  if (data.currency !== undefined && data.currency !== "USD")
    throw new CheckoutError("Printify shipping currency does not match its USD source.", 503);
  const methods = [
    { key: "standard", method: 1, label: "Standard" },
    {
      key: data.priority !== undefined && data.priority !== null ? "priority" : "express",
      method: 2,
      label: "Priority",
    },
    { key: "printify_express", method: 3, label: "Printify Express" },
    { key: "economy", method: 4, label: "Economy" },
  ];
  const options: ShippingOption[] = [];
  for (const { key, method, label } of methods) {
    const value = data[key];
    if (value !== undefined && value !== null) {
      if (!validateAmount(value))
        throw new CheckoutError("Invalid shipping price from Printify.", 503);
      options.push({ method, label, price: pricing.convert(value), currency: pricing.currency });
    }
  }
  if (!options.length) throw new CheckoutError("Shipping is unavailable for this address.", 400);
  return options;
}

export async function quoteCart(
  config: PrintifyConfig,
  items: CartItem[],
  address: Address,
): Promise<Quote> {
  const pricing = usdPricing(config);
  const shopId = await resolveShop(config);
  const products = new Map<string, Product>();
  const priced: PricedItem[] = [];
  let subtotal = 0;
  for (const item of items) {
    let product = products.get(item.productId);
    if (!product) {
      const result = await printifyRequest(
        config,
        `/shops/${shopId}/products/${encodeURIComponent(item.productId)}.json`,
      );
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new CheckoutError("Invalid product response from Printify.", 503);
      product = result as Product;
      if (product.currency !== undefined && product.currency !== "USD")
        throw new CheckoutError("Printify product currency does not match its USD source.", 503);
      if (
        product.id !== item.productId ||
        !isPublished(product) ||
        !Array.isArray(product.variants)
      ) {
        throw new CheckoutError("A product is no longer available.");
      }
      products.set(item.productId, product);
    }
    const variant = product.variants.find((candidate) => candidate.id === item.variantId);
    if (variant?.currency !== undefined && variant.currency !== "USD")
      throw new CheckoutError("Printify variant currency does not match its USD source.", 503);
    if (
      !variant ||
      variant.is_enabled !== true ||
      variant.is_available === false ||
      !validateAmount(variant.price) ||
      variant.price === 0
    ) {
      throw new CheckoutError("A product variant is no longer available.");
    }
    const price = pricing.convert(variant.price);
    const lineTotal = price * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || subtotal + lineTotal > 99_999_999)
      throw new CheckoutError("Cart total is too large.");
    subtotal += lineTotal;
    priced.push({
      ...item,
      price,
      currency: pricing.currency,
      title: typeof product.title === "string" ? product.title.slice(0, 120) : "Product",
      variantTitle:
        typeof variant.title === "string" ? variant.title.slice(0, 100) : String(variant.id),
    });
  }
  const result = await printifyRequest(config, `/shops/${shopId}/orders/shipping.json`, "POST", {
    line_items: items.map(({ productId, variantId, quantity }) => ({
      product_id: productId,
      variant_id: variantId,
      quantity,
    })),
    address_to: address,
  });
  return {
    shopId,
    currency: pricing.currency,
    items: priced,
    address,
    subtotal,
    options: shippingOptions(result, pricing).filter(
      (option) => config.allowExpress !== false || option.method !== 3,
    ),
  };
}

export async function createPrintifyOrder(
  config: PrintifyConfig & { allowExpress: boolean },
  shopId: string,
  sessionId: string,
  items: CartItem[],
  address: Address,
  shippingMethod: number,
): Promise<string> {
  if (shippingMethod === 3 && !config.allowExpress)
    throw new CheckoutError("Printify Express is disabled for fulfillment tests.", 400);
  const path = `/shops/${shopId}/orders${shippingMethod === 3 ? "/express" : ""}.json`;
  const result = await printifyRequest(config, path, "POST", {
    external_id: sessionId,
    label: sessionId,
    line_items: items.map(({ productId, variantId, quantity }) => ({
      product_id: productId,
      variant_id: variantId,
      quantity,
    })),
    shipping_method: shippingMethod,
    send_shipping_notification: false,
    address_to: address,
  });
  if (shippingMethod === 3) {
    // Express may create both an express and an ordinary order. Preserve every ID for reconciliation.
    const orders = (result as { data?: unknown } | null)?.data;
    if (
      !Array.isArray(orders) ||
      !orders.length ||
      !orders.every((order) => order?.type === "order" && typeof order.id === "string")
    ) {
      throw new CheckoutError("Printify Express response lacked order IDs.", 503);
    }
    return JSON.stringify(orders.map((order) => order.id));
  }
  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as { id?: unknown }).id !== "string"
  ) {
    throw new CheckoutError("Printify order response lacked an order ID.", 503);
  }
  return (result as { id: string }).id;
}
