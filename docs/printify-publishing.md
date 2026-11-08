# Printify publishing verification

Verified on the live Worker on 23 October 2026.

The catalog now requires both `visible=true` and a nonempty `external.id`.
Existing publication markers from the former Pop-Up channel are retained;
new products with `visible=true` and no publication marker stay hidden.
Checkout re-fetches the same publication state before quoting or taking payment.

Signed subscriptions are installed on shop `12336149` for:

- `product:publish:started`
- `product:updated`
- `product:deleted`

All target `https://utxowear.osbyrne.workers.dev/api/printify-webhook` and use
the Worker secret `PRINTIFY_WEBHOOK_SECRET`. Unsigned requests returned HTTP 400.
The signature is verified over the raw request body using HMAC SHA-256.

On 8 November 2026, all three subscriptions moved to
`https://utxowear.com/api/printify-webhook`. Their signing secrets were retained.
Both webhook paths on the custom domain reject unsigned requests. The evidence
below describes the earlier publication test, not a new publication run.

End-to-end verification used temporary product `6adb8b6a8c5ce03a880d9ad7`:

1. A newly created draft stayed absent from the live catalog.
2. Printify's actual Publish request delivered a signed event to the Worker.
3. The Worker acknowledged publication and Printify returned the persistent
   external ID plus the website catalog link; the product was unlocked.
4. The published product appeared in the live catalog.
5. Unpublishing removed the external marker, and the product disappeared.
6. The temporary product was deleted and its temporary artwork archived.

No payment or fulfillment order was created. The existing stuck request for
“Copy of Santigoat” was released with `publishing_failed` so it remains a draft
and can be published deliberately. Santigoat and Stork science also remain
unpublished until the merchant explicitly publishes them.

Catalog changes propagate across Worker isolates within 30 seconds. Published
products stay listed while an update is pending. Completed event replays are
ignored when Printify reports no current publishing lock. Upstream API or
acknowledgement failures return a retryable error. Authenticated catalog failures
and empty catalogs cannot resurrect public fallback products.

63 tests passed, Astro type checking reported no errors or warnings, lint passed,
and the production build and deployment succeeded. Existing Worker variables,
Stripe secrets, D1 database, and session KV binding were preserved.
