import { isPublished } from "./publication";
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

export function normalizePublicProduct(
  product: PublicStoreProduct,
  _config: PrintifyConfig,
): StoreProduct | undefined {
  if (!product.image) return undefined;

  return {
    id: product.externalId ?? String(product.id),
    title: product.title,
    description: plainText(product.description),
    price: product.defaultVariant?.retailPrice ?? 0,
    currency: "USD",
    variants: [],
    defaultVariantId: null,
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
  _config: PrintifyConfig,
): StoreProduct | undefined {
  const enabledVariants = product.variants.filter(
    (variant) => variant.is_enabled && variant.is_available !== false && variant.price > 0,
  );
  const selected = enabledVariants.find((variant) => variant.is_default) ?? enabledVariants[0];
  const images = [...product.images].sort((left, right) => imageOrder(left) - imageOrder(right));

  if (!images.length || !selected) return undefined;

  const optionValues = new Map<number, { name: string; value: string }>();
  for (const option of product.options ?? []) {
    for (const value of option.values) {
      optionValues.set(value.id, { name: option.name, value: value.title });
    }
  }

  return {
    id: product.id,
    title: product.title,
    description: plainText(product.description),
    price: selected.price,
    currency: "USD",
    mockups: images.map((image) => image.src),
    variants: enabledVariants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: variant.price,
      options: variant.options.flatMap((id) => {
        const option = optionValues.get(id);
        return option ? [option] : [];
      }),
      image: images.find((image) => image.variant_ids?.includes(variant.id))?.src ?? images[0].src,
    })),
    defaultVariantId: selected.id,
  };
}

export function normalizeApiProducts(
  products: readonly PrintifyProduct[],
  config: PrintifyConfig,
): StoreProduct[] {
  return products
    .filter(isPublished)
    .map((product) => normalizeApiProduct(product, config))
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
