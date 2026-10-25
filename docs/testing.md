# Testing

Use `bun run check` for TypeScript/Astro checks and `bun test` for the focused
runtime regressions. `bunfig.toml` keeps Bun's runner scoped to `src/lib`, so
it does not try to execute Playwright's browser specs.

The runtime suite covers risks that static typing cannot establish:

- Published products across API pagination; drafts and failed/empty catalogs
  cannot become fallback listings.
- Printify HMAC authentication, shop isolation, publish/unpublish state changes,
  and completed-event replay.
- Integer money conversion and failure when a conversion rate is unavailable.
- Stripe USD/EUR session snapshots, paid totals, tax, currency, and signatures.
- Signed webhook environment isolation, simulated fulfillment, separate test-shop
  routing, Express rejection in tests, and prevention of simulated-session promotion.
- Draft rejection before shipping/payment.
- Duplicate fulfillment and uncertain submissions using the real migration
  and actual SQLite queries, rather than a fake SQL state machine. This is not
  a substitute for checking Cloudflare D1 in a deployed payment test.

The previous 63-case suite was reduced by removing config/string normalization,
public-store HTML parser internals, retry timers, sorting/filtering helpers,
repeated invalid-rate examples, and redundant mock request-shape checks.
Browser behavior now covers search and cart use directly. Rare decoder/retry
branches and legacy public-preview parsing no longer have exhaustive coverage.

## Browser checks

```sh
bun run test:e2e
```

These are three browser smoke tests, defaulting to
`https://utxowear.osbyrne.workers.dev`. To target a local or staging server:

```sh
E2E_BASE_URL=http://localhost:4321 bun run test:e2e
```

The target must have published products and working Printify shipping
configuration. Tests use separate fresh browser contexts and require no API keys
in the runner. They deliberately depend on the target's real catalog and shipping
service so missing production credentials and broken product/image loading fail.
They can fail when an upstream service is unavailable; no retries hide that.

On macOS, the runner uses installed Google Chrome. On Linux/CI, install Chromium:

```sh
bunx playwright install --with-deps chromium
```

The browser checks cover:

1. Product images load; catalog search finds a shirt and shows an empty result.
2. Bag quantity survives page navigation, and removing the shirt empties the bag.
3. A real USD shipping quote enables checkout and supplies its trusted total;
   a simulated Stripe cancellation returns to a retained bag.

All `/api/checkout` requests are blocked or fulfilled locally by the test runner.
The Stripe navigation in the third case is intercepted too. These smoke tests
cannot charge a payment or create Printify orders. They do not test the Stripe
hosted payment form, webhook delivery, or production fulfillment. A normal sandbox
payment uses `FULFILLMENT_MODE=simulate` and cannot create Printify orders.
Deliberate real-order testing requires `FULFILLMENT_MODE=test`, a separate
`PRINTIFY_TEST_SHOP_ID`, and Manual approval in that test shop; Express is blocked.
See [environment setup](../README.md#environments), the historical
[checkout E2E report](checkout-e2e.md), and
[publishing verification](printify-publishing.md).

Failure screenshots and traces are saved under ignored `test-results/`.
