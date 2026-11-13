# utxowear web site repository

## Product whitepapers

Add `Whitepaper: https://whitepapers.utxowear.com/bitcoin.pdf` as a separate line
in a Printify product description to display a **Download whitepaper** button on
its product page. Host your own PDF copy in Cloudflare R2, or deploy it with the
website and use `Whitepaper: /whitepapers/bitcoin.pdf`.
See [whitepaper setup](docs/whitepapers.md) for upload and publishing instructions.

## On-site checkout

The storefront displays Printify products and enabled size/color variants. The
cart collects a delivery address, asks Printify for destination-specific shipping
rates, and starts a Stripe-hosted payment. A Stripe-signed webhook creates the
Printify order **only after a live payment succeeds in production mode**.
Sandbox payments simulate fulfillment unless a separate test shop is explicitly
enabled (see [Environments](#environments)). The Printify token and Stripe
secret keys are never sent to browsers. Public-store or local fallback products
have no trustworthy variant IDs and cannot be purchased through this checkout.

This application uses React and TanStack Start on **Cloudflare Workers**, with a D1
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
4. Keep `FULFILLMENT_MODE=simulate` for normal sandbox payments. Completed paid
   sessions are recorded locally as `simulated`; no Printify order is submitted.
   Use the explicit test-shop procedure below only when deliberately verifying
   real Printify order creation.

Local sandbox payment, webhook, duplicate-delivery, and Printify order creation
were verified on 22 October 2026; the test order was canceled without production.
See [checkout end-to-end verification](docs/checkout-e2e.md) for historical evidence
and limits. That report predates the environment guard; sandbox payments now
simulate fulfillment by default.
Stripe Checkout uses dashboard-managed dynamic payment methods.

## Environments

`FULFILLMENT_MODE` controls physical order creation independently of the hostname,
`NODE_ENV`, or whether the Worker runs locally. An unset value defaults to
`simulate`; an unrecognized value fails closed. Local development and staging
should normally use `simulate`.

| Configuration            | Stripe API key and signed events | Printify catalog and shipping                                      | Paid-session fulfillment                                          |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `simulate` (default)     | Test mode only                   | `PRINTIFY_SHOP_ID`, or the existing single-shop fallback           | D1 row with `status='simulated'`, no Printify order or production |
| `production`             | Live mode only                   | Required `PRINTIFY_SHOP_ID`                                        | Real order in that production shop; its approval settings apply   |
| `test` (explicit opt-in) | Test mode only                   | Required `PRINTIFY_TEST_SHOP_ID`, distinct from `PRINTIFY_SHOP_ID` | Real order in the separate test shop; Express is blocked          |

Both the signed Stripe event and Checkout Session must contain matching boolean
`livemode` values for the configured mode. Missing, inconsistent, or wrong-mode
values are rejected before any fulfillment ledger or Printify write. Checkout
also rejects a live API key in sandbox modes or a test API key in production
before creating a Stripe customer/session. Standard `sk_` and restricted `rk_`
keys are supported. Keep API keys, webhook signing secrets, and endpoint/listener
mode aligned; a signing secret alone does not identify test versus live mode.

### Normal development and staging

```dotenv
FULFILLMENT_MODE=simulate
```

Use a Stripe sandbox API key, its sandbox webhook secret or CLI listener secret,
and local/staging D1. Printify catalog and shipping calls remain real API reads
and quotes; only paid-order fulfillment is simulated. The webhook returns
`{"received":true,"fulfillment":"simulated"}` after recording the session ID
with no Printify order ID. Duplicate deliveries reuse that record. Changing the
mode later cannot turn an already simulated session into a physical order; start
a new checkout for a deliberate fulfillment test.

### Production

```dotenv
FULFILLMENT_MODE=production
PRINTIFY_SHOP_ID=<production-shop-id>
```

Use a live Stripe key, a live webhook endpoint/signing secret, the production
Printify credentials, and production D1. Signed sandbox events are rejected and
cannot create orders. Real customer orders may keep automatic approval enabled;
the application does not change Printify approval settings.

The `production` Wrangler environment sets `FULFILLMENT_MODE=production`.
The `preview` environment sets `simulate`. Local `.env` files do not configure
deployed Worker secrets. Register both completion events described in Deployment.

### Deliberate Printify fulfillment tests

```dotenv
FULFILLMENT_MODE=test
PRINTIFY_SHOP_ID=<production-shop-id>
PRINTIFY_TEST_SHOP_ID=<different-test-shop-id>
```

This mode is an explicit opt-in to **real Printify orders**, even though Stripe
uses test money. Create a separate Printify API shop, set that shop's order
approval to **Manual**, and publish the products to test there. Configure its API
credentials and test-shop product webhooks in the isolated local/staging
environment. `PRINTIFY_SHOP_ID` remains the production-shop reference; catalog,
quotes, publishing acknowledgements, and order submission select
`PRINTIFY_TEST_SHOP_ID`. Never substitute or relabel production product IDs as
test-shop products. Orders whose signed snapshot names another shop are rejected.

Express is removed from test shipping options and rejected again at webhook and
provider submission, including sessions issued before a mode change. Ordinary
orders still depend on the test shop's actual Manual approval setting: the app
does not verify or change that setting. Reconcile and cancel test orders in
Printify, then restore `FULFILLMENT_MODE=simulate` and restart the local server.
Use separate D1 databases and webhook secrets for development, staging, and
production; do not replay production events into a test deployment.

Printify has no sandbox order API. Its [Express approval rules](https://help.printify.com/hc/en-us/articles/7435676870545-What-is-Express-Delivery-and-how-does-it-work)
bypass Manual approval, and its [order API](https://developers.printify.com/#orders)
can accept eligible Express products even when Express is disabled in the
dashboard. Printify settings alone cannot establish this boundary.

Simulation applies to order fulfillment. Product publishing webhooks still
perform real Printify writes in their selected shop; register subscriptions only
for the intended environment. Keep each environment's settings in its own secret
store or ignored local file. With local Wrangler, `.dev.vars` takes precedence
over `.env`; use one, not both, and restart after changing modes or shop IDs.

### Deployment

Development uses `trunk`. Each verified trunk commit deploys the `preview`
Worker at `https://preview.utxowear.com`. Production at `https://utxowear.com`
deploys only from a `vX.Y.Z` tag whose commit belongs to `origin/trunk`.
GitHub Actions runs the checks, builds for the selected environment, verifies
the generated bindings, applies D1 migrations, and deploys that build.

See [release and deployment instructions](docs/deployment.md) for provider setup,
Cloudflare Access, environment secrets, releases, and recovery.
The environment-specific `CHECKOUT_ORIGIN`, fulfillment mode, catalog settings,
and resource IDs are version-controlled in `wrangler.jsonc`. Worker secrets
remain in Cloudflare. Local development uses its own D1 and KV storage.

Failed or uncertain fulfillment attempts require manual reconciliation against
the Stripe Session ID (Printify external order ID). Do not retry an ambiguous
submission blindly; it could create two orders. Successful checkout redirect is
not a fulfillment confirmation: the webhook is authoritative.

The server re-fetches prices at checkout and rejects a currency or total that no
longer matches the displayed quote. Stripe line items and version 3 checkout
metadata carry the server currency; signed webhooks must match that currency,
subtotal, shipping, tax, and paid total. Existing version 2 USD sessions remain
valid independently of the current store currency.

Printify Express can split one cart into express and ordinary fulfillment orders
and starts production immediately regardless of Manual approval. It is available
for live production orders and blocked for opted-in fulfillment tests.

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

| Command                             | Action                                                          |
| :---------------------------------- | :-------------------------------------------------------------- |
| `bun dev`                           | Generate Worker types and start the React/Cloudflare dev server |
| `bun run migrate:local`             | Apply checkout ledger migration to local D1                     |
| `bun run migrate:preview`           | Apply checkout ledger migrations to preview D1                  |
| `bun run migrate:production`        | Apply checkout ledger migrations to production D1               |
| `bun check`                         | Type-check the React application and TypeScript                 |
| `bun test`                          | Run the focused runtime integration tests                       |
| `bun run test:e2e`                  | Run the storefront browser suite against the configured store   |
| `bun run build`                     | Build the Worker into `dist/`                                   |
| `bun test ./scripts/deploy.test.ts` | Verify deployment and release restrictions                      |
| `bun run deploy:preview`            | Build, migrate, and deploy a clean trunk checkout to preview    |
| `bun run deploy:production`         | Build, migrate, and deploy a clean release tag to production    |

## Styling

The frontend uses React, TypeScript, and TanStack Start with TanStack Router.
All page components and the shared document live in `src/routes/`. Product pages
render their title and preview metadata on the server. The homepage loads the
complete catalog after hydration, and the 3D view remains on `/3d-shirt`.
See [frontend architecture](docs/frontend-architecture.md) for ownership and data flow.

Component styles use [StyleX](https://stylexjs.com/). The official
`@stylexjs/unplugin` Vite plugin compiles styles into the production stylesheets.

- `src/styles/theme.stylex.ts` defines shared colors and typography.
- `src/styles/storefront.stylex.ts` defines shared storefront styles.
- React components apply styles with `stylex.props(...)`.
- `src/app.css` contains fonts and the global reset in a lower cascade layer.

Run `bun run check` and `bun run build` to validate changes.

See [testing](docs/testing.md) for scope, browser setup, and payment-test limits.

### Contact form email delivery

`/contact` posts to `/api/contact`. Only the server sends to the fixed inbox;
HTML, browser JavaScript, and API responses never include the destination address.
Delivery uses the Resend HTTP API directly, without an SDK dependency. Configure:

- `RESEND_API_KEY`: a Resend sending API key.
- `CONTACT_FROM_EMAIL`: a sender address on a domain verified in Resend.

For local development, set these in your ignored local environment file (see the
example files). For production, set them with `bunx wrangler secret put RESEND_API_KEY --env production`
and `bunx wrangler secret put CONTACT_FROM_EMAIL --env production`, then deploy. Never use `PUBLIC_`
variables for these settings. Missing configuration returns a generic unavailable
message and preserves the visitor's form. Provider errors are not exposed.
The sender's email is used as Reply-To, so replies go to the visitor.
The form validates input on both sides, caps request size, checks same-origin
submissions, and includes a honeypot. The honeypot is basic spam mitigation;
configure Cloudflare rate limiting or Turnstile if automated abuse becomes an issue.
