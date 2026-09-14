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

function currentEnvironment(): PrintifyEnvironment {
  return {
    PRINTIFY_API_TOKEN: import.meta.env.PRINTIFY_API_TOKEN,
    PRINTIFY_SHOP_ID: import.meta.env.PRINTIFY_SHOP_ID,
    PRINTIFY_STORE_URL: import.meta.env.PRINTIFY_STORE_URL,
    PRINTIFY_CURRENCY: import.meta.env.PRINTIFY_CURRENCY,
  };
}

export async function getPrintifyProducts(): Promise<StoreProduct[]> {
  const { config, warnings } = configFromEnvironment(currentEnvironment());
  for (const warning of warnings) {
    console.warn(`[Printify] ${warning.message}`);
  }

  const catalog = makeCatalog(config);
  return Effect.runPromise(Effect.provide(catalog, FetchLive));
}
