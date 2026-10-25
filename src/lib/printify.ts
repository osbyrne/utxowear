import * as Effect from "effect/Effect";

import {
  normalizePrintifyConfig,
  type ConfigResult,
  type PrintifyConfigInput,
} from "./printify/model";
import { makeCatalog } from "./printify/catalog";
import { FetchLive } from "./printify/client";
import type { StoreProduct } from "./printify/model";
import { priceCatalog } from "./pricing";
import { fulfillmentEnvironment, type FulfillmentBindings } from "./checkout/environment";

export type { StoreProduct } from "./printify/model";

export type PrintifyEnvironment = Readonly<
  FulfillmentBindings & {
    readonly PRINTIFY_API_TOKEN?: string;
    readonly PRINTIFY_STORE_URL?: string;
    readonly PRINTIFY_CURRENCY?: string;
    readonly PRINTIFY_USD_TO_EUR_RATE?: string;
  }
>;

export function configFromEnvironment(environment: PrintifyEnvironment): ConfigResult {
  const input: PrintifyConfigInput = {
    token: environment.PRINTIFY_API_TOKEN,
    shopId: fulfillmentEnvironment(environment).shopId,
    storeUrl: environment.PRINTIFY_STORE_URL,
    currency: environment.PRINTIFY_CURRENCY,
  };
  return normalizePrintifyConfig(input);
}

// Worker isolates reuse modules across requests. Coalesce catalog loads and avoid
// calling Printify on every page view (including its rate-limited catalog API).
let catalogCache: { products: StoreProduct[]; expiresAt: number } | undefined;
let catalogLoad: Promise<StoreProduct[]> | undefined;
const CATALOG_TTL_MS = 30_000;

export function invalidatePrintifyCatalog(): void {
  catalogCache = undefined;
}

export function getPrintifyProducts(environment: PrintifyEnvironment): Promise<StoreProduct[]> {
  const price = (products: StoreProduct[]) =>
    priceCatalog(products, {
      currency: environment.PRINTIFY_CURRENCY,
      usdToEurRate: environment.PRINTIFY_USD_TO_EUR_RATE,
    });
  if (catalogCache && Date.now() < catalogCache.expiresAt)
    return Promise.resolve(price(catalogCache.products));
  if (catalogLoad) return catalogLoad.then(price);

  catalogLoad = (async () => {
    const { config, warnings } = configFromEnvironment(environment);
    for (const warning of warnings) console.warn(`[Printify] ${warning.message}`);
    const products = await Effect.runPromise(Effect.provide(makeCatalog(config), FetchLive));
    catalogCache = { products, expiresAt: Date.now() + CATALOG_TTL_MS };
    return products;
  })().finally(() => {
    catalogLoad = undefined;
  });
  return catalogLoad.then(price);
}
