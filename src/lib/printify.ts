import * as Effect from "effect/Effect";

import {
  normalizePrintifyConfig,
  type ConfigResult,
  type PrintifyConfigInput,
} from "./printify/model";
import { makeCatalog } from "./printify/catalog";
import { FetchLive } from "./printify/client";
import type { StoreProduct } from "./printify/model";

export type { StoreProduct } from "./printify/model";

export type PrintifyEnvironment = Readonly<{
  readonly PRINTIFY_API_TOKEN?: string;
  readonly PRINTIFY_SHOP_ID?: string;
  readonly PRINTIFY_STORE_URL?: string;
  readonly PRINTIFY_CURRENCY?: string;
}>;

export function configFromEnvironment(environment: PrintifyEnvironment): ConfigResult {
  const input: PrintifyConfigInput = {
    token: environment.PRINTIFY_API_TOKEN,
    shopId: environment.PRINTIFY_SHOP_ID,
    storeUrl: environment.PRINTIFY_STORE_URL,
    currency: environment.PRINTIFY_CURRENCY,
  };
  return normalizePrintifyConfig(input);
}

// Worker isolates reuse modules across requests. Coalesce catalog loads and avoid
// calling Printify on every page view (including its rate-limited catalog API).
let catalogCache: { products: StoreProduct[]; expiresAt: number } | undefined;
let catalogLoad: Promise<StoreProduct[]> | undefined;
const CATALOG_TTL_MS = 5 * 60_000;

export function getPrintifyProducts(environment: PrintifyEnvironment): Promise<StoreProduct[]> {
  if (catalogCache && Date.now() < catalogCache.expiresAt)
    return Promise.resolve(catalogCache.products);
  if (catalogLoad) return catalogLoad;

  catalogLoad = (async () => {
    const { config, warnings } = configFromEnvironment(environment);
    for (const warning of warnings) console.warn(`[Printify] ${warning.message}`);
    const products = await Effect.runPromise(Effect.provide(makeCatalog(config), FetchLive));
    catalogCache = { products, expiresAt: Date.now() + CATALOG_TTL_MS };
    return products;
  })().finally(() => {
    catalogLoad = undefined;
  });
  return catalogLoad;
}
