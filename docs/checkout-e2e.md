# Checkout end-to-end verification

Verified locally on 22 October 2026 against the Stripe sandbox and the real
Printify utxowear shop (`12336149`). No live Stripe payment was taken.

- Selected Santigoat, L / White, quantity 1 through the product catalog UI.
- Entered a test delivery address in France and requested real Printify shipping.
- Product: USD 25.99; standard shipping: USD 10.39; total: USD 36.38.
- Stripe Tax completed with USD 0.00 tax for this sandbox configuration. This
  does not verify live tax registrations or collection in other jurisdictions.
- A declined Stripe test card left the Checkout Session open and unpaid, with
  no fulfillment ledger entry.
- A successful Stripe test card completed the hosted checkout and returned to
  the storefront's success URL.
- The Stripe CLI forwarded the actual `checkout.session.completed` event to
  `/api/stripe-webhook`, which returned HTTP 200.
- Local D1 recorded the session as `created` with its Printify order ID.
- Two concurrent signed replays of the actual event both returned HTTP 200;
  Printify still contained exactly one matching order.
- Printify's order was verified `on-hold`, then canceled as test cleanup. The
  final order and line item statuses were `canceled`; production was not started.

References for reconciliation:

- Stripe sandbox session:
  `cs_test_b1iyKeCjARd2l4vlfR5OOc8nFf8jTgOs2QKnyVFbnEU3bNwScBOYL46NKq`
- Stripe sandbox event: `evt_1UTL7wCY9o50lWP2c05UatED`
- Printify canceled order: `6ada01be7ae6b31db004588f`

The test exposed a Stripe API rejection of `payment_method_types`. Checkout now
omits that parameter and uses dashboard-managed dynamic payment methods. The
existing USD/EUR checkout regression covers the updated request shape.

Sandbox Stripe Tax was activated by copying the existing live head-office
address and defaults into sandbox settings. Live settings were not changed.
General Printify order submission was changed from automatic after 24 hours to
Manual and verified after reload; personalized orders were already Manual.

Temporary Worker secrets and webhook forwarding were used for this test; the
live key in `.env` was preserved. This test does not validate production Worker
secrets, remote D1 migrations, deployed webhook delivery, or actual printing and
shipping. Local D1 intentionally retains the created fulfillment record so the
same paid session cannot create another order after cleanup.

Validation: 55 tests passed, Astro check reported no errors or warnings, lint
passed, and the production build passed.
