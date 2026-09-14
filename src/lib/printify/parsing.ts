import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import {
  type PrintifyConfig,
  PublicProductArraySchema,
  type PrintifyProduct,
  type PrintifyShop,
  type PublicStoreProduct,
  type StoreProduct,
} from "./model";

export type PublicExtractionResult =
  | {
      readonly _tag: "Success";
      readonly products: readonly PublicStoreProduct[];
    }
  | {
      readonly _tag: "Failure";
      readonly reason: "no-flight-payload" | "no-products-candidate" | "invalid-products-candidate";
    };

/**
 * Return the balanced JSON array beginning at `start`, respecting escaped
 * quotes and brackets inside JSON strings.
 */
export function extractJsonArray(source: string, start: number): string | undefined {
  if (source[start] !== "[") return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

export function readFlightPayload(html: string): string {
  const scriptPattern = /<script>self\.__next_f\.push\((.*?)\)<\/script>/gs;
  const chunks: string[] = [];

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const payload: unknown = JSON.parse(match[1]);
      if (Array.isArray(payload) && typeof payload[1] === "string") {
        chunks.push(payload[1]);
      }
    } catch {
      // Unrelated or incomplete Next.js flight chunks are not catalog errors.
    }
  }

  return chunks.join("");
}

const hasUsablePublicProduct = (product: PublicStoreProduct): boolean =>
  Boolean(product.externalId && product.image);

/**
 * Scan every embedded `products` array until a valid, useful candidate is
 * found. A valid empty/non-useful candidate is still a successful empty
 * catalog; malformed candidates do not prevent later candidates from being
 * considered.
 */
export function extractPublicProducts(html: string): PublicExtractionResult {
  const payload = readFlightPayload(html);
  if (!payload) {
    return { _tag: "Failure", reason: "no-flight-payload" };
  }

  const markerPattern = /"products"\s*:\s*\[/g;
  let sawCandidate = false;
  let sawValidCandidate = false;

  for (const match of payload.matchAll(markerPattern)) {
    if (match.index === undefined) continue;
    sawCandidate = true;
    const arrayStart = match.index + match[0].lastIndexOf("[");
    const productJson = extractJsonArray(payload, arrayStart);
    if (!productJson) continue;

    try {
      const decoded: unknown = JSON.parse(productJson);
      const products = Schema.decodeUnknownEither(PublicProductArraySchema)(decoded);

      if (!Either.isRight(products)) continue;
      sawValidCandidate = true;
      if (products.right.some(hasUsablePublicProduct)) {
        return { _tag: "Success", products: products.right };
      }
    } catch {
      // A later candidate may contain the valid catalog.
    }
  }

  if (sawValidCandidate) {
    return { _tag: "Success", products: [] };
  }

  return {
    _tag: "Failure",
    reason: sawCandidate ? "invalid-products-candidate" : "no-products-candidate",
  };
}

export function plainText(value = ""): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveUrl(path: string | undefined, baseUrl: string): string {
  if (!path) return baseUrl;

  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

export function publicProductHref(
  product: Pick<PublicStoreProduct, "path">,
  config: PrintifyConfig,
): string {
  return resolveUrl(product.path, config.storeUrl);
}

export function productHref(handle: string | undefined, config: PrintifyConfig): string {
  return resolveUrl(handle, config.storeUrl);
}

export function normalizePublicProduct(
  product: PublicStoreProduct,
  config: PrintifyConfig,
): StoreProduct | undefined {
  if (!product.image) return undefined;

  return {
    id: product.externalId ?? String(product.id),
    title: product.title,
    description: plainText(product.description),
    price: product.defaultVariant?.retailPrice ?? 0,
    currency: config.currency,
    href: publicProductHref(product, config),
    mockups: [product.image],
  };
}

function imageOrder(image: PrintifyProduct["images"][number]): number {
  if (image.is_default) return 0;
  if (image.position === "front") return 1;
  return 2;
}

export function normalizeApiProduct(
  product: PrintifyProduct,
  publicProducts: ReadonlyMap<string, PublicStoreProduct>,
  config: PrintifyConfig,
): StoreProduct | undefined {
  const publicProduct = publicProducts.get(product.id);
  const enabledVariants = product.variants.filter((variant) => variant.is_enabled);
  const defaultVariant = enabledVariants.find((variant) => variant.is_default);
  const price =
    defaultVariant?.price ??
    (enabledVariants.length > 0
      ? Math.min(...enabledVariants.map((variant) => variant.price))
      : Number.POSITIVE_INFINITY);
  const images = [...product.images].sort((left, right) => imageOrder(left) - imageOrder(right));

  if (!images.length || !Number.isFinite(price)) return undefined;

  return {
    id: product.id,
    title: product.title,
    description: plainText(product.description),
    price,
    currency: config.currency,
    href: publicProduct
      ? publicProductHref(publicProduct, config)
      : productHref(product.external?.handle, config),
    mockups: images.map((image) => image.src),
  };
}

export function createPublicProductIndex(
  products: readonly PublicStoreProduct[],
): ReadonlyMap<string, PublicStoreProduct> {
  return new Map(
    products.flatMap((product) =>
      product.externalId ? [[product.externalId, product] as const] : [],
    ),
  );
}

export function normalizeApiProducts(
  products: readonly PrintifyProduct[],
  publicProducts: readonly PublicStoreProduct[],
  config: PrintifyConfig,
): StoreProduct[] {
  const publicProductIndex = createPublicProductIndex(publicProducts);

  return products
    .filter((product) => product.visible)
    .map((product) => normalizeApiProduct(product, publicProductIndex, config))
    .filter((product): product is StoreProduct => Boolean(product));
}

export function chooseShop(
  shops: readonly PrintifyShop[],
  config: PrintifyConfig,
): PrintifyShop | undefined {
  if (config.shopId) {
    return shops.find((shop) => String(shop.id) === config.shopId);
  }

  return shops.find((shop) => shop.title.trim().toLowerCase() === config.storeSlug) ?? shops.at(0);
}
