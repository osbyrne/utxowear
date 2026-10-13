import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

export const API_BASE_URL = "https://api.printify.com/v1";
export const DEFAULT_STORE_URL = "https://utxowear.printify.me/";
export const DEFAULT_CURRENCY = "USD";
export const USER_AGENT = "utxowear-storefront/1.0";

export const REQUEST_TIMEOUT_MS = 10_000;
export const SOURCE_BUDGET_MS = 60_000;
export const MAX_RETRIES = 2;
export const MAX_API_PAGES = 100;

export type Source = "public" | "api";

export type StoreVariant = {
  id: number;
  title: string;
  price: number;
  options: { name: string; value: string }[];
  image?: string;
};

export type StoreProduct = {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  mockups: string[];
  variants: StoreVariant[];
  defaultVariantId: number | null;
};

export type PrintifyConfigInput = {
  readonly storeUrl?: string;
  readonly currency?: string;
  readonly shopId?: string;
  readonly token?: string;
};

export type PrintifyConfig = Readonly<{
  readonly storeUrl: string;
  readonly storeSlug: string;
  readonly currency: string;
  readonly shopId?: string;
  readonly token?: string;
}>;

export type ConfigWarning = Readonly<{
  readonly field: "storeUrl" | "currency";
  readonly message: string;
}>;

export type ConfigResult = Readonly<{
  readonly config: PrintifyConfig;
  readonly warnings: readonly ConfigWarning[];
}>;

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly field: string;
  readonly reason: string;
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly source: Source;
  readonly path: string;
  readonly page?: number;
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly source: Source;
  readonly path: string;
  readonly page?: number;
}> {}

export class HttpStatusError extends Data.TaggedError("HttpStatusError")<{
  readonly source: Source;
  readonly path: string;
  readonly status: number;
  readonly page?: number;
  readonly retryAfterMs?: number;
}> {}

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly source: Source;
  readonly path: string;
  readonly page?: number;
}> {}

export class ExtractionError extends Data.TaggedError("ExtractionError")<{
  readonly source: Source;
  readonly path: string;
}> {}

export class ShopSelectionError extends Data.TaggedError("ShopSelectionError")<{
  readonly shopId?: string;
  readonly storeSlug: string;
}> {}

export class PaginationError extends Data.TaggedError("PaginationError")<{
  readonly page: number;
  readonly lastPage?: number;
}> {}

export class BudgetExceededError extends Data.TaggedError("BudgetExceededError")<{
  readonly source: Source;
}> {}

export type PrintifyError =
  | ConfigurationError
  | TransportError
  | TimeoutError
  | HttpStatusError
  | DecodeError
  | ExtractionError
  | ShopSelectionError
  | PaginationError
  | BudgetExceededError;

const validStoreUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

const validCurrency = (value: string): boolean => {
  if (!/^[a-z]{3}$/i.test(value)) return false;

  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value });
    return true;
  } catch {
    return false;
  }
};

export function normalizePrintifyConfig(input: PrintifyConfigInput = {}): ConfigResult {
  const requestedStoreUrl = input.storeUrl?.trim();
  const storeUrl =
    requestedStoreUrl && validStoreUrl(requestedStoreUrl) ? requestedStoreUrl : DEFAULT_STORE_URL;
  const requestedCurrency = input.currency?.trim();
  const currency =
    requestedCurrency && validCurrency(requestedCurrency)
      ? requestedCurrency.toUpperCase()
      : DEFAULT_CURRENCY;
  const warnings: ConfigWarning[] = [];

  if (requestedStoreUrl && storeUrl === DEFAULT_STORE_URL && storeUrl !== requestedStoreUrl) {
    warnings.push({
      field: "storeUrl",
      message: "PRINTIFY_STORE_URL is invalid; using the default storefront URL.",
    });
  }

  if (
    requestedCurrency &&
    currency === DEFAULT_CURRENCY &&
    requestedCurrency.toUpperCase() !== DEFAULT_CURRENCY
  ) {
    warnings.push({
      field: "currency",
      message: "PRINTIFY_CURRENCY is invalid; using USD.",
    });
  }

  const url = new URL(storeUrl);
  return {
    config: Object.freeze({
      storeUrl,
      storeSlug: url.hostname.split(".")[0]?.toLowerCase() ?? "",
      currency,
      shopId: input.shopId?.trim() || undefined,
      token: input.token?.trim() || undefined,
    }),
    warnings: Object.freeze(warnings),
  };
}

export function validatePrintifyConfig(
  config: PrintifyConfig,
): PrintifyConfig | ConfigurationError {
  if (!validStoreUrl(config.storeUrl)) {
    return new ConfigurationError({
      field: "storeUrl",
      reason: "store URL must be an http(s) URL without credentials",
    });
  }

  if (!validCurrency(config.currency)) {
    return new ConfigurationError({
      field: "currency",
      reason: "currency must be a supported three-letter code",
    });
  }

  if (!config.storeSlug) {
    return new ConfigurationError({
      field: "storeSlug",
      reason: "store URL must have a hostname",
    });
  }

  return config;
}

const FiniteNonNegativeNumber = Schema.Number.pipe(Schema.finite(), Schema.nonNegative());
const NonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive());

export const PrintifyShopSchema = Schema.Struct({
  id: PositiveInteger,
  title: Schema.String,
});

export const PrintifyShopArraySchema = Schema.Array(PrintifyShopSchema);

export const PrintifyImageSchema = Schema.Struct({
  src: Schema.String,
  position: Schema.String,
  is_default: Schema.Boolean,
  variant_ids: Schema.optional(Schema.Array(PositiveInteger)),
});

export const PrintifyOptionSchema = Schema.Struct({
  name: Schema.String,
  values: Schema.Array(Schema.Struct({ id: PositiveInteger, title: Schema.String })),
});

export const PrintifyVariantSchema = Schema.Struct({
  id: PositiveInteger,
  title: Schema.String,
  options: Schema.Array(PositiveInteger),
  price: NonNegativeInteger,
  is_enabled: Schema.Boolean,
  is_available: Schema.optional(Schema.Boolean),
  is_default: Schema.Boolean,
});

export const PrintifyProductSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  visible: Schema.Boolean,
  images: Schema.Array(PrintifyImageSchema),
  options: Schema.optional(Schema.Array(PrintifyOptionSchema)),
  variants: Schema.Array(PrintifyVariantSchema),
  external: Schema.optional(
    Schema.Struct({
      handle: Schema.optional(Schema.String),
    }),
  ),
});

export const ProductPageSchema = Schema.Struct({
  data: Schema.Array(PrintifyProductSchema),
  last_page: PositiveInteger,
  current_page: Schema.optional(PositiveInteger),
});

export const PublicProductSchema = Schema.Struct({
  id: PositiveInteger,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  externalId: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  defaultVariant: Schema.optional(
    Schema.Struct({
      retailPrice: Schema.optional(FiniteNonNegativeNumber),
    }),
  ),
});

export const PublicProductArraySchema = Schema.Array(PublicProductSchema);

export type PrintifyShop = Schema.Schema.Type<typeof PrintifyShopSchema>;
export type PrintifyImage = Schema.Schema.Type<typeof PrintifyImageSchema>;
export type PrintifyVariant = Schema.Schema.Type<typeof PrintifyVariantSchema>;
export type PrintifyProduct = Schema.Schema.Type<typeof PrintifyProductSchema>;
export type ProductPage = Schema.Schema.Type<typeof ProductPageSchema>;
export type PublicStoreProduct = Schema.Schema.Type<typeof PublicProductSchema>;
