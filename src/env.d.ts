declare module "virtual:stylex:css-only";

declare namespace Cloudflare {
  interface Env {
    PRINTIFY_API_TOKEN?: string;
    PRINTIFY_SHOP_ID?: string;
    PRINTIFY_STORE_URL?: string;
    PRINTIFY_CURRENCY?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    CHECKOUT_ORIGIN?: string;
  }
}
