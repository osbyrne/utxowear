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
The store uses `PRINTIFY_CURRENCY=USD`: product prices, shipping quotes, and
Stripe payments are all in US dollars, using Printify USD retail prices as the
source of truth. Buyers paying with a card in another currency have conversion
handled by their card issuer, which may apply exchange fees. No exchange-rate
configuration is needed for USD checkout.

Optional EUR support remains available through `PRINTIFY_CURRENCY=EUR`.
For EUR, set `PRINTIFY_USD_TO_EUR_RATE` to a merchant-approved rate in **EUR per
1 USD** (positive decimal, at most six decimal places). The server converts both
product unit prices and shipping, rounding each once to integer cents, half up.
Maintain this rate as exchange rates and fulfillment costs change; this is a
merchant pricing policy, not a live FX service or Printify billing conversion.
No rate is assumed. Until a valid rate is set, the catalog shows the actual USD
source prices with purchase controls unavailable, and EUR quotes fail closed.
Changing `PRINTIFY_CURRENCY` alone never converts or relabels source amounts.

Printify's [API shipping calculation](https://developers.printify.com/#calculate-the-shipping-cost-of-an-order)
returns unlabelled amounts, and its [currency guidance](https://help.printify.com/hc/en-us/articles/4483625794577-In-which-currency-can-I-sell-my-products)
identifies shipping rates and Pop-Up transactions as USD. Its
[retail pricing guidance](https://help.printify.com/hc/en-us/articles/12203816692113-How-does-publishing-work-if-I-ve-changed-my-billing-currency-in-Printify)
also explains that other sales channels can assign their own currency to numeric
retail prices. Do not use this USD conversion policy for a shop whose retail
numbers already represent another currency. Printify Pop-Up's own hosted checkout
remains USD-only; EUR payments here use this site's Stripe checkout. API order
creation support for the chosen shop must still be confirmed before release.

Shipping options are calculated by Printify for the
chosen products and address. Checkout charges the merchandise price and the
selected shipping charge; tax is calculated in Stripe Checkout when Stripe Tax
is configured for the merchant's registered jurisdictions. Configure your
Stripe Tax registrations, product tax defaults, and reporting obligations
before accepting live payments.

### Local setup

1. Run `bun install`. Copy `.env.example` to `.env` and supply
   `PRINTIFY_API_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
   `CHECKOUT_ORIGIN=http://localhost:4321`. Set `PRINTIFY_SHOP_ID` to the
   Printify shop whose products are listed (especially if you have multiple
   shops). Never commit `.env`. Do not keep a `.dev.vars` file alongside `.env`: Wrangler
   gives `.dev.vars` precedence and ignores `.env` entirely.
2. Run `bun run migrate:local`, then `bun dev`. Wrangler provides local D1
   and Worker secrets from `.env`. Only products returned by the
   authenticated Printify API can be purchased.
3. Authenticate with `bunx @stripe/cli login`, then run `bun run stripe:listen`
   in a separate terminal. This forwards sandbox checkout completion events to
   `http://localhost:4321/api/stripe-webhook`. Use the listener's signing secret
   as `STRIPE_WEBHOOK_SECRET` in `.env`; restart `bun dev`. CLI login
   authenticates the CLI separately from this application: the server still
   needs a sandbox API key from the Stripe Dashboard as `STRIPE_SECRET_KEY`.
   The listener defaults to sandbox mode. For live payments, use a live-mode
   webhook endpoint and its own signing secret; a sandbox listener secret does
   not configure delivery of live payment events.
4. Test a complete payment with Stripe test credentials and a valid Printify
   test shop before accepting real money. Printify has no sandbox order API:
   a successful paid test checkout can create an actual fulfillment order.
   Set Printify order approval to **Manual** while testing and reconcile orders
   in the Printify dashboard before release.

Local sandbox payment, webhook, duplicate-delivery, and Printify order creation
were verified on 22 October 2026; the test order was canceled without production.
See [checkout end-to-end verification](docs/checkout-e2e.md) for evidence and limits.
Stripe Checkout uses dashboard-managed dynamic payment methods.

### Deployment

Run `bun run build` and `bunx wrangler deploy` from an authenticated Cloudflare
account. Wrangler provisions the D1 binding `CHECKOUT_DB` on first deployment;
record the generated database ID in `wrangler.jsonc` and apply
`bun run migrate:remote` before taking payments. Set secrets with
`bunx wrangler secret put PRINTIFY_API_TOKEN`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and `CHECKOUT_ORIGIN`, and set
`PRINTIFY_SHOP_ID`, `PRINTIFY_CURRENCY`, and (for EUR) `PRINTIFY_USD_TO_EUR_RATE`
for this Worker. Register
`https://YOUR-DOMAIN/api/stripe-webhook` in Stripe with the
`checkout.session.completed` event; its signing secret must match the deployed
`STRIPE_WEBHOOK_SECRET`. Configure `CHECKOUT_ORIGIN` as the exact public HTTPS
origin. Apply future migrations before deploying code that depends on them.

Failed or uncertain fulfillment attempts require manual reconciliation against
the Stripe Session ID (Printify external order ID). Do not retry an ambiguous
submission blindly; it could create two orders. Successful checkout redirect is
not a fulfillment confirmation: the webhook is authoritative.

The server re-fetches prices at checkout and rejects a currency or total that no
longer matches the displayed quote. Stripe line items and version 3 checkout
metadata carry the server currency; signed webhooks must match that currency,
subtotal, shipping, tax, and paid total. Existing version 2 USD sessions remain
valid independently of the current store currency.

Printify Express can split one cart into express and ordinary fulfillment orders;
its production scheduling is controlled by Printify. Confirm shop approval and
express behavior in Printify before enabling live Express checkout.

The authenticated Printify API is authoritative: only products with `visible=true`
and a nonempty `external.id` publication marker appear or pass checkout validation.
New drafts have `visible=true` too, so visibility alone is insufficient. Published
products remain listed during an update; new pending products stay hidden until
publishing is acknowledged. A successful empty catalog and API failures never
resurrect public previews or placeholder products. Without an API token, the
legacy public preview fallback remains available for local demonstrations.

### Printify publishing

Register signed webhooks for `product:publish:started`, `product:updated`, and
`product:deleted` at `https://YOUR-DOMAIN/api/printify-webhook`. Supply the same
random shared signing secret in each Printify subscription and in the Worker
secret `PRINTIFY_WEBHOOK_SECRET`. These are separate from Stripe webhooks.
The handler verifies Printify's `X-Pfy-Signature` HMAC over the raw body and scopes
API operations to `PRINTIFY_SHOP_ID`.

Printify Publish sends create/update requests. The handler checks the pending
product and acknowledges it with `publishing_succeeded`, setting its persistent
external ID and a link into our catalog. Products missing mockups or available
priced variants receive `publishing_failed`. Unpublish sends a delete publishing
action; the handler acknowledges it through Printify's `unpublish` endpoint.
Completed publishing deliveries are no-ops when replayed. Changes invalidate the
receiving isolate's catalog cache; other isolates refresh within 30 seconds.
Checkout always re-fetches publication state, so a cached card cannot sell a draft
or an unpublished product. Existing published markers from the old Pop-Up store
are preserved; drafts are not automatically published during migration.

## Commands

| Command                  | Action                                                          |
| :----------------------- | :-------------------------------------------------------------- |
| `bun dev`                | Generate Worker types and start the Astro/Cloudflare dev server |
| `bun run migrate:local`  | Apply checkout ledger migration to local D1                     |
| `bun run migrate:remote` | Apply checkout ledger migration to production D1                |
| `bun check`              | Type-check Astro and TypeScript                                 |
| `bun test`               | Run the focused runtime integration tests                       |
| `bun run test:e2e`       | Run three browser smoke tests against the live store             |
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

See [testing](docs/testing.md) for scope, browser setup, and payment-test limits.
