# utxowear web site repository

## On-site checkout

The storefront displays Printify products and enabled size/color variants. The
cart collects a delivery address, asks Printify for destination-specific shipping
rates, and starts a Stripe-hosted payment. A Stripe-signed webhook creates the
Printify order **only after payment succeeds**. The Printify token and Stripe
secret keys are never sent to browsers. Public-store or local fallback products
have no trustworthy variant IDs and cannot be purchased through this checkout.

This application runs as an Astro server on **Cloudflare Workers**, with a D1
database used to prevent duplicate fulfillment on Stripe webhook retries. It
cannot be deployed as a static-only site. The Printify API must grant access to
the shop that owns the listed products; use a shop supporting API order creation.
The checkout accepts USD prices and shipping quotes; use
`PRINTIFY_CURRENCY=USD`. Shipping options are calculated by Printify for the
chosen products and address. Checkout charges the merchandise price and the
selected shipping charge; tax is calculated in Stripe Checkout when Stripe Tax
is configured for the merchant's registered jurisdictions. Configure your
Stripe Tax registrations, product tax defaults, and reporting obligations
before accepting live payments.

### Local setup

1. Run `bun install`. Copy `.dev.vars.example` to `.dev.vars` and supply
   `PRINTIFY_API_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
   `CHECKOUT_ORIGIN=http://localhost:4321`. Set `PRINTIFY_SHOP_ID` to the
   Printify shop whose products are listed (especially if you have multiple
   shops). Never commit `.dev.vars`.
2. Run `bun run migrate:local`, then `bun dev`. Wrangler provides local D1
   and Worker secrets from `.dev.vars`. Only products returned by the
   authenticated Printify API can be purchased.
3. In a separate terminal, forward Stripe test webhooks for
   `checkout.session.completed` to `http://localhost:4321/api/stripe-webhook`.
   Use the signing secret printed by the Stripe CLI as
   `STRIPE_WEBHOOK_SECRET` in `.dev.vars`; restart `bun dev`.
4. Test a complete payment with Stripe test credentials and a valid Printify
   test shop before accepting real money. Printify has no sandbox order API:
   a successful paid test checkout can create an actual fulfillment order.
   Set Printify order approval to **Manual** while testing and reconcile orders
   in the Printify dashboard before release.

### Deployment

Run `bun run build` and `bunx wrangler deploy` from an authenticated Cloudflare
account. Wrangler provisions the D1 binding `CHECKOUT_DB` on first deployment;
record the generated database ID in `wrangler.jsonc` and apply
`bun run migrate:remote` before taking payments. Set secrets with
`bunx wrangler secret put PRINTIFY_API_TOKEN`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and `CHECKOUT_ORIGIN`, and set
`PRINTIFY_SHOP_ID` and `PRINTIFY_CURRENCY=USD` for this Worker. Register
`https://YOUR-DOMAIN/api/stripe-webhook` in Stripe with the
`checkout.session.completed` event; its signing secret must match the deployed
`STRIPE_WEBHOOK_SECRET`. Configure `CHECKOUT_ORIGIN` as the exact public HTTPS
origin. Apply future migrations before deploying code that depends on them.

Failed or uncertain fulfillment attempts require manual reconciliation against
the Stripe Session ID (Printify external order ID). Do not retry an ambiguous
submission blindly; it could create two orders. Successful checkout redirect is
not a fulfillment confirmation: the webhook is authoritative.

Printify Express can split one cart into express and ordinary fulfillment orders;
its production scheduling is controlled by Printify. Confirm shop approval and
express behavior in Printify before enabling live Express checkout.

The catalog requests Printify's public storefront first, then, with a token,
pages through the authenticated product API. API data supplies all mockups,
enabled variants, and prices. If the API is unavailable, the grid still displays
public products, but purchase controls remain unavailable. Each Worker isolate
caches a complete catalog for five minutes and coalesces concurrent page loads.
The server/client catalog implementation is in `src/lib/printify/`.

## Commands

| Command                  | Action                                                          |
| :----------------------- | :-------------------------------------------------------------- |
| `bun dev`                | Generate Worker types and start the Astro/Cloudflare dev server |
| `bun run migrate:local`  | Apply checkout ledger migration to local D1                     |
| `bun run migrate:remote` | Apply checkout ledger migration to production D1                |
| `bun check`              | Type-check Astro and TypeScript                                 |
| `bun test`               | Run deterministic integration tests                             |
| `bun run build`          | Build the Worker into `dist/`                                   |
| `bun run deploy`         | Build and deploy the Worker                                     |

## Styling

Component styles use [StyleX](https://stylexjs.com/). The official
`@stylexjs/unplugin` Vite plugin compiles styles and includes the generated CSS in
Astro's production stylesheet. The development-only stylesheet and HMR import in
`src/pages/index.astro` keep server-rendered styles up to date during `bun dev`.

- `src/styles/theme.stylex.ts` defines shared colors and typography.
- `src/styles/storefront.stylex.ts` defines the Astro storefront styles. Apply
  them with `stylex.attrs(...)`; keep compiler-only `stylex.create` in
  TypeScript modules, outside Astro templates.
- React components use `stylex.props(...)`, with the 3D preview styles colocated
  in `src/components/Shirt.tsx`.
- `src/app.css` contains only the font import and a global reset, in a lower
  cascade layer than the generated component styles.

Use explicit border width, style, and color properties in StyleX definitions.
Run `bun check` and `bun build` to validate changes.
