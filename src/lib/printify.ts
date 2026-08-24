import fallbackProductNames from "../../products.json";

const API_BASE_URL = "https://api.printify.com/v1";
const DEFAULT_STORE_URL = "https://utxowear.printify.me/";
const DEFAULT_CURRENCY = "USD";
const FETCH_TIMEOUT_MS = 10_000;

export type StoreProduct = {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  href: string;
  mockups: string[];
};

type PrintifyShop = {
  id: number;
  title: string;
};

type PrintifyImage = {
  src: string;
  position: string;
  is_default: boolean;
};

type PrintifyVariant = {
  price: number;
  is_enabled: boolean;
  is_default: boolean;
};

type PrintifyProduct = {
  id: string;
  title: string;
  description?: string;
  visible: boolean;
  images: PrintifyImage[];
  variants: PrintifyVariant[];
  external?: {
    handle?: string;
  };
};

type PublicStoreProduct = {
  id: number;
  title: string;
  description?: string;
  image?: string;
  externalId?: string;
  path?: string;
  defaultVariant?: {
    retailPrice?: number;
  };
};

type PublicProductIndex = Map<string, PublicStoreProduct>;

function getStoreUrl() {
  return import.meta.env.PRINTIFY_STORE_URL?.trim() || DEFAULT_STORE_URL;
}

function getStoreSlug() {
  return new URL(getStoreUrl()).hostname.split(".")[0]?.toLowerCase();
}

async function printifyFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "utxowear-storefront/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Printify API returned ${response.status} for ${path}`);
  }

  return response.json() as Promise<T>;
}

function chooseShop(shops: PrintifyShop[]): PrintifyShop | undefined {
  const configuredId = import.meta.env.PRINTIFY_SHOP_ID?.trim();
  if (configuredId) {
    return shops.find((shop) => String(shop.id) === configuredId);
  }

  const slug = getStoreSlug();
  return (
    shops.find((shop) => shop.title.trim().toLowerCase() === slug) ??
    shops.at(0)
  );
}

function extractJsonArray(source: string, start: number): string | undefined {
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

function readFlightPayload(html: string): string {
  const scriptPattern = /<script>self\.__next_f\.push\((.*?)\)<\/script>/gs;
  const chunks: string[] = [];

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const payload = JSON.parse(match[1]) as [number, string?];
      if (typeof payload[1] === "string") chunks.push(payload[1]);
    } catch {
      // Ignore unrelated or incomplete Next.js flight chunks.
    }
  }

  return chunks.join("");
}

function parsePublicProducts(html: string): PublicStoreProduct[] {
  const payload = readFlightPayload(html);
  const marker = '"products":[';
  let markerIndex = payload.indexOf(marker);

  while (markerIndex !== -1) {
    const arrayStart = markerIndex + marker.length - 1;
    const productJson = extractJsonArray(payload, arrayStart);

    if (productJson) {
      try {
        const products = JSON.parse(productJson) as PublicStoreProduct[];
        if (products.some((product) => product.externalId && product.image))
          return products;
      } catch {
        // Another products field may occur later in the page payload.
      }
    }

    markerIndex = payload.indexOf(marker, markerIndex + marker.length);
  }

  return [];
}

async function getPublicStoreProducts(): Promise<PublicStoreProduct[]> {
  const response = await fetch(getStoreUrl(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "utxowear-storefront/1.0" },
  });

  if (!response.ok)
    throw new Error(`Printify storefront returned ${response.status}`);
  return parsePublicProducts(await response.text());
}

function publicProductHref(product: PublicStoreProduct) {
  return product.path
    ? new URL(product.path, getStoreUrl()).toString()
    : getStoreUrl();
}

function productHref(handle?: string) {
  return handle ? new URL(handle, getStoreUrl()).toString() : getStoreUrl();
}

function plainText(value = "") {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublicProduct(
  product: PublicStoreProduct,
): StoreProduct | undefined {
  if (!product.image) return undefined;

  return {
    id: product.externalId ?? String(product.id),
    title: product.title,
    description: plainText(product.description),
    price: product.defaultVariant?.retailPrice ?? 0,
    currency: import.meta.env.PRINTIFY_CURRENCY?.trim() || DEFAULT_CURRENCY,
    href: publicProductHref(product),
    mockups: [product.image],
  };
}

function normalizeApiProduct(
  product: PrintifyProduct,
  publicProducts: PublicProductIndex,
): StoreProduct | undefined {
  const publicProduct = publicProducts.get(product.id);
  const enabledVariants = product.variants.filter(
    (variant) => variant.is_enabled,
  );
  const defaultVariant = enabledVariants.find((variant) => variant.is_default);
  const price =
    defaultVariant?.price ??
    Math.min(...enabledVariants.map((variant) => variant.price));
  const images = [...product.images].sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    if (left.position !== right.position)
      return left.position === "front" ? -1 : 1;
    return 0;
  });

  if (!images.length || !Number.isFinite(price)) return undefined;

  return {
    id: product.id,
    title: product.title,
    description: plainText(product.description),
    price,
    currency: import.meta.env.PRINTIFY_CURRENCY?.trim() || DEFAULT_CURRENCY,
    href: publicProduct
      ? publicProductHref(publicProduct)
      : productHref(product.external?.handle),
    mockups: images.map((image) => image.src),
  };
}

async function getApiProducts(
  token: string,
  publicProducts: PublicStoreProduct[],
) {
  const shops = await printifyFetch<PrintifyShop[]>("/shops.json", token);
  const shop = chooseShop(shops);
  if (!shop) throw new Error("No Printify shop was found for this account");

  const products: PrintifyProduct[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const response = await printifyFetch<{
      data: PrintifyProduct[];
      last_page: number;
    }>(`/shops/${shop.id}/products.json?limit=50&page=${page}`, token);

    products.push(...response.data);
    lastPage = response.last_page;
    page += 1;
  } while (page <= lastPage);

  const publicProductIndex = new Map(
    publicProducts.flatMap((product) =>
      product.externalId ? [[product.externalId, product] as const] : [],
    ),
  );

  return products
    .filter((product) => product.visible)
    .map((product) => normalizeApiProduct(product, publicProductIndex))
    .filter((product): product is StoreProduct => Boolean(product));
}

function fallbackProducts(): StoreProduct[] {
  return fallbackProductNames.map((title, index) => ({
    id: `fallback-${index}`,
    title,
    description: "Heavyweight cotton / unisex fit",
    price: 6400,
    currency: DEFAULT_CURRENCY,
    href: getStoreUrl(),
    mockups: ["/shirt_transparent.png"],
  }));
}

export async function getPrintifyProducts(): Promise<StoreProduct[]> {
  let publicProducts: PublicStoreProduct[] = [];

  try {
    publicProducts = await getPublicStoreProducts();
  } catch (error) {
    console.warn("Could not load the public Printify storefront:", error);
  }

  const token = import.meta.env.PRINTIFY_API_TOKEN?.trim();
  if (token) {
    try {
      const apiProducts = await getApiProducts(token, publicProducts);
      if (apiProducts.length) return apiProducts;
    } catch (error) {
      console.warn("Could not load products from the Printify API:", error);
    }
  }

  const storefrontProducts = publicProducts
    .map(normalizePublicProduct)
    .filter((product): product is StoreProduct => Boolean(product));

  return storefrontProducts.length ? storefrontProducts : fallbackProducts();
}
