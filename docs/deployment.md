# Release and deployment instructions

## Configure the environments

1. Keep `trunk` as the default branch. Merge short-lived branches into trunk.
2. In GitHub, create the `preview` and `production` environments. Restrict preview
   deployments to the `trunk` branch and production deployments to `v*` tags.
   Keep the `Release tag integrity` ruleset active to prevent release tag updates
   and deletions.
3. Set `CLOUDFLARE_API_TOKEN` as a secret in each GitHub environment. Grant the
   deployment token Workers Scripts Edit, Workers KV Storage Edit, D1 Edit,
   Zone Read, and Workers Routes Edit for the account and zone in `wrangler.jsonc`.
   Use separate tokens if independent revocation is required.
4. Remove Cloudflare Workers Builds triggers that deploy `utxowear` from trunk
   or other branches. GitHub Actions owns deployment. A second deployment
   mechanism can overwrite a tagged release.
5. Retain the production D1 database and session namespace. Preview uses the
   separate resources recorded under `env.preview` in `wrangler.jsonc`.
6. Configure Worker secrets with an explicit environment:

   ```sh
   bunx wrangler secret put PRINTIFY_API_TOKEN --env preview --config wrangler.jsonc
   bunx wrangler secret put STRIPE_SECRET_KEY --env preview --config wrangler.jsonc
   bunx wrangler secret put STRIPE_WEBHOOK_SECRET --env preview --config wrangler.jsonc
   ```

   Supply the Printify catalog token, a valid Stripe sandbox `sk_test_` or
   `rk_test_` key, and the preview endpoint's signing secret. `STRIPE_TEST_SECRET_KEY`
   is not an application binding. The sandbox key belongs in preview's
   `STRIPE_SECRET_KEY`. Retain live credentials on `--env production`.
   Neither environment inherits secrets from the other or from `.env`.

7. Register a sandbox Stripe webhook endpoint at
   `https://preview.utxowear.com/api/stripe-webhook`. Enable
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Save the returned signing secret directly to the preview Worker.
   A local CLI listener signing secret cannot replace this endpoint's secret.
8. Update the existing live Stripe endpoint to
   `https://utxowear.com/api/stripe-webhook`, keeping its signing secret and both
   completion events. Do this before the first tagged deployment disables
   `utxowear.osbyrne.workers.dev`.
9. Keep Printify publishing subscriptions on production, at
   `https://utxowear.com/api/printify-webhook`, with production's
   `PRINTIFY_WEBHOOK_SECRET`. Do not register preview publishing subscriptions.
   Preview reads the production catalog and shipping quotes but simulates paid
   fulfillment. Publishing acknowledgements would modify the shared shop.
10. To enable contact email, set `RESEND_API_KEY` and `CONTACT_FROM_EMAIL` on
    the intended Worker using its explicit environment. Preview does not inherit
    production's email credentials.

`CHECKOUT_ORIGIN` is `https://preview.utxowear.com` for preview and
`https://utxowear.com` for production. These values and `FULFILLMENT_MODE` are
Wrangler variables. Remove old secrets with either name if a previous setup
stored them as secrets. Do not override them with dashboard variables.

The root Wrangler configuration serves local development. Its storage is local
and its name is `utxowear-local`. Use `.env.example` with a sandbox key for local
checkout. `bun run migrate:local` applies migrations to that local database.
An existing local database under the former production binding is not migrated
into the new local database.

## Protect preview with Cloudflare Access

Configure Access before the first preview deployment. The deployment token does
not need Access administration permissions after setup. The setup credential
needs Access Apps and Policies Edit and Access Organizations, Identity Providers,
and Groups Edit. Removing an existing Workers Builds trigger also needs Workers CI Edit.

1. Create a Cloudflare Zero Trust organization if the account does not have one.
2. Configure an identity provider or email one-time PIN login.
3. Create a self-hosted Access application for `preview.utxowear.com`.
4. Select the existing Cloudflare identity provider. Add an Allow policy for
   members of the `osbyrne` Cloudflare account. Access uses your Cloudflare login.
5. Create a second self-hosted application for
   `preview.utxowear.com/api/stripe-webhook` with an Everyone Bypass policy.
   The more specific path application lets Stripe deliver events. The handler
   still requires a valid Stripe signature and matching sandbox event mode.
   Keep all other paths behind the developer login.
6. Confirm an anonymous request to the preview homepage redirects to Access.
   An unsigned POST to the Stripe webhook must reach the application and fail
   signature verification, without an Access login redirect.

Both deployed environments disable `workers_dev` and `preview_urls`. The custom
domain is preview's only public entry point, so a second Worker hostname cannot
bypass its hostname-based Access policy. Access protects static assets as well
as application routes. Do not enable alternate hostnames without protecting them.

See Cloudflare's [hostname and path Access configuration](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
and Stripe's [webhook endpoint API](https://docs.stripe.com/api/webhook_endpoints/create).

## Deploy preview

Push a commit to trunk. The `Verify and deploy` workflow runs lint, formatting,
type checks, runtime tests, deployment tests, and builds for both environments.
The preview job deploys after verification succeeds. Pull requests run verification
without deployment credentials.

To deploy the same clean trunk checkout from an authenticated local terminal, run:

```sh
bun run deploy:preview
```

The deployment command builds with `CLOUDFLARE_ENV=preview` and rejects an artifact
with a different Worker, checkout origin, fulfillment mode, route, or storage binding.
Wrangler's version annotation records the trunk commit.

## Release production

After verifying preview, create an annotated release tag on the tested trunk commit:

```sh
git switch trunk
git pull --ff-only origin trunk
git tag -a v0.0.1 -m "Release v0.0.1"
git push origin v0.0.1
```

Choose the next unused version. Tags use exactly `vMAJOR.MINOR.PATCH` without
leading zeroes or prerelease suffixes. The production job rejects tags that
identify a commit outside trunk. Deployment jobs serialize writes per environment.

For an authenticated local release deployment, check out the tag, then run:

```sh
git switch --detach v0.0.1
bun run deploy:production
```

The command fetches the current `origin/trunk`, verifies the tag and clean working
directory, and deploys the production build with its release tag and commit
annotation. Existing production secrets remain on the production Worker.
No Stripe payment or Printify order is created by deployment.

## Recover a failed deployment

Re-run a failed GitHub Actions job after correcting its cause. D1 tracks applied
migrations, so re-running does not apply a completed migration again. A failure
after migrations can leave the database ahead of the deployed code. Keep schema
changes compatible with the current production release until a later release
removes obsolete columns or tables.

To restore earlier application behavior, revert the change on trunk, verify
preview, and issue a new release tag. Keep existing release tags unchanged.
A code rollback does not reverse D1 migrations, payments, or Printify orders.
Reconcile uncertain fulfillment against the Stripe Session ID before any retry.

Successful builds and API configuration do not establish a completed checkout.
Verify Access login, a sandbox payment, webhook delivery, and the simulated D1
record before relying on preview for release acceptance.
