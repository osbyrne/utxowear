# Effect implementation plan for GPT-5.6 Luna Max

Prepared September 14, 2026. This is an implementation handoff; application code has not been changed.

## Objective and scope

Introduce Effect into the build-time Printify integration to provide typed failures, runtime response validation, abortable requests, bounded retries, and testable dependencies. Preserve the rendered storefront and its product-selection behavior.

The repository uses Astro 7.3.1, React 19, TypeScript 6, Bun, StyleX, and a React Three Fiber/Cannon shirt preview. `astro.config.mjs` has no server adapter. The useful adoption boundary is `src/lib/printify.ts`, called from the frontmatter of `src/pages/index.astro`. Effect should execute during Astro builds/development and stay out of browser JavaScript.

Do not migrate `Shirt.tsx`, React hooks, rendering, styles, or physics. Do not add an API server, deployment adapter, persistent runtime, cache, telemetry backend, or Effect platform packages for this task. Keep pure parsing and normalization helpers as ordinary TypeScript functions where appropriate.

## Version decision

Use the newest published **3.x stable patch**, pinned exactly in `package.json`, for this adoption. Resolve the actual patch at implementation time and record it in the README; do not invent a version number. Update `bun.lock` through Bun.

This is a deliberate conservative choice: the [Effect homepage](https://effect.website/) currently promotes `effect@rc`, and the [4.0 announcement](https://effect.website/blog/releases/effect/40-rc) describes a release candidate. Use [versioned v3 documentation](https://effect.website/docs/v3/getting-started/installation) and installed declarations throughout. Do not copy v4 examples into v3 code or switch major versions midway. A later v4 migration is a separate task.

## Existing behavior to preserve

Read the current implementation before editing; this plan describes the inspected revision.

1. Fetch the public Printify storefront first, extracting product data from embedded Next.js Flight chunks.
2. With a nonblank API token, fetch shops, select a shop, and fetch every product page sequentially (`limit=50`). Prefer nonempty normalized API results.
3. Select the configured shop ID exactly when provided; otherwise match the store hostname's first segment against the shop title, then use the first shop. An unmatched explicit ID must not silently select another shop.
4. If the API is unavailable, invalid, or has no usable products, use public products with images.
5. If neither source yields usable products, use `products.json` and `/shirt_transparent.png`.

Preserve `getPrintifyProducts(): Promise<StoreProduct[]>` and the existing `StoreProduct` export. Keep API visibility filtering, enabled/default variant pricing, default/front image ordering, public `externalId` link matching, handle fallback, description cleanup, source product order, and integer minor-unit prices. API/public currency uses the configured value or USD; local fallback currently always uses USD and a price of 6400. Do not accidentally change that distinction.

## Implementation sequence

Complete each step and its verification before advancing. Work in this task; no additional tasks or agents are needed.

### 1. Establish the baseline and dependency

- Read applicable repository instructions and inspect `git status` and the current diff. `package.json` and `bun.lock` already contain user changes; preserve them.
- Run `bun check` and `bun build`, recording pre-existing failures and source/fallback behavior. Builds may use network and local credentials; never print `.env` or tokens.
- Install the exact selected Effect 3.x patch with Bun. Avoid unrelated dependency upgrades.
- Add `test: bun test` and Bun test typings only if needed. Keep Astro's strict TypeScript configuration.

Acceptance: dependency resolves, a minimal Effect program typechecks, and baseline results are recorded.

### 2. Separate contracts, decoding, and pure logic

Use this small module layout; avoid a generic application framework:

| File                          | Responsibility                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/printify.ts`         | Existing public exports; Astro environment adapter; single Promise execution boundary |
| `src/lib/printify/model.ts`   | `StoreProduct`, input schemas, tagged errors, validated configuration type            |
| `src/lib/printify/parsing.ts` | Flight extraction, product decoding, pure normalization and shop selection            |
| `src/lib/printify/client.ts`  | Injectable fetch service, request policy, shops and product-page effects              |
| `src/lib/printify/catalog.ts` | Source selection, pagination orchestration, fallback and safe diagnostics             |
| `src/lib/printify/*.test.ts`  | Deterministic tests with synthetic fixtures                                           |

The facade re-exports `StoreProduct` as a type, preserving existing consumer imports. Internal modules must not import the facade or read `import.meta.env`.

Use Effect Schema to decode `unknown` values at external boundaries: shops, API pagination envelopes, API products, and extracted public products. Infer upstream types from schemas instead of maintaining duplicate interfaces. Accept additional upstream properties and preserve existing optional fields. Validate finite nonnegative prices and integer positive pagination metadata; no unchecked `response.json() as T` assertions.

Preserve the Flight scanner's escaped-string/bracket handling and its search through multiple candidate arrays. Ignore unrelated malformed chunks; distinguish valid empty catalogs from extraction/decode failures. Define a documented policy: an invalid API envelope/product rejects that API attempt and triggers public fallback; an invalid public candidate allows scanning subsequent candidates, then triggers local fallback if none works. Do not silently invent missing required data.

Acceptance: fixtures cover valid payloads, malformed JSON, changed shapes, empty arrays, optional fields, unrelated Flight chunks, escaped brackets/quotes, and a valid candidate after an invalid candidate.

### 3. Build a narrow Effect request layer

Use `Context.Tag` and a live/test `Layer` for the fetch capability. Pass validated immutable configuration into the catalog factory; do not create a separate service for every helper. Wrap the full fetch-and-body-read operation with `Effect.tryPromise`, passing its cancellation signal to native fetch. Compose with an Effect timeout so interruption aborts the underlying request, including body consumption.

Use tagged errors for configuration, transport, timeout, HTTP status, decode/extraction, shop selection, and invalid pagination. Keep safe metadata such as source, status, and page. Never log authorization headers, complete response bodies, environment objects, or raw errors that may contain secrets.

Adopt these explicit request policies:

- Preserve the existing 10-second timeout per attempt and User-Agent.
- Retry idempotent GETs only for transport failures, timeouts, 408, 429, and 5xx responses. Maximum two retries, three total attempts.
- Use exponential delay starting at 250 ms with jitter. Honor valid `Retry-After` delta-seconds or HTTP dates when supplied, bounded by the remaining catalog budget; fall back rather than retry sooner than the server permits.
- Never retry other 4xx responses, schema/JSON failures, configuration errors, or missing shops.
- Add a 60-second total budget for each complete source operation, including retries and all API pages. On API budget exhaustion, retain public results and fall back to them. Public and API operations remain sequential, so the combined network budget is at most roughly 120 seconds.
- Keep pagination sequential and complete. Validate metadata and cap at 100 pages; exceeding the cap fails the API source instead of publishing a partial catalog. Document this intentional bound.

Read and trim existing `PRINTIFY_*` variables only in the facade when invoked. Validate the store URL and currency before normalization. Invalid optional URL/currency overrides should emit a sanitized warning and use their existing defaults, ensuring local fallback remains renderable. Treat the token as a redacted secret and reveal it only when constructing the authenticated API request. Public requests must never receive it.

Acceptance: mocked tests verify request headers, cancellation, status classification, attempt counts, budget exhaustion, and pagination termination. Verify exact APIs against the installed v3 declarations.

### 4. Compose the catalog and connect the facade

Implement the workflow with `Effect.gen`. Keep effects composable below the facade; call `Effect.runPromise` only at the Astro-facing boundary after providing the live layer.

Recover expected source errors at the public/API source boundaries using typed handlers, logging one sanitized diagnostic per exhausted source. Preserve partial success across sources, but never return partial API pages after a page failure. Ordinary programming defects should surface rather than be swallowed with a blanket catch-all.

Keep `src/pages/index.astro`, `Product.astro`, and `ProductList.astro` unchanged unless a type-only compatibility adjustment is required. Do not introduce Effect values into component props or client modules.

Acceptance: the unchanged `await getPrintifyProducts()` call renders plain product objects and follows the original precedence.

### 5. Verify behavior and document operation

Use Bun tests with an injected fetch layer and supplied configuration, without live network or real credentials. Use Effect's test clock for schedules/budgets so tests do not sleep in real time; verify compatibility with the installed release.

Required scenarios:

| Scenario                                                                           | Expected result                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| No token; valid public storefront                                                  | Public products; no API requests                              |
| Valid token; multiple API pages                                                    | All usable visible API products in source order               |
| API 401/403, decode error, missing shop, empty usable result, or failed later page | Public products; no partial API result                        |
| Public source fails; API succeeds                                                  | API products using handle/store links                         |
| Both sources fail or have no usable products                                       | Local catalog with original names, price, currency, and image |
| Transient failure followed by success                                              | Bounded retry and successful products                         |
| Permanent status/decode failure                                                    | No retry                                                      |
| Hung fetch or hung response body                                                   | Cancellation followed by fallback                             |
| Explicit shop ID mismatch, malformed pagination, or page cap                       | Typed API failure and public fallback                         |
| Invalid URL/currency override                                                      | Safe default and renderable catalog                           |

Also test normalization details and that captured diagnostics never contain a synthetic token. Test the facade separately with absent credentials or an environment fixture so environment translation is covered.

Run `bun test`, `bun check`, and `bun build`. Inspect generated HTML for product count, prices, links, and mockups; preview the page to confirm the shirt scene and styling remain intact. Inspect browser bundle imports or build metadata to confirm the Effect pipeline is excluded from client chunks. A live build using fallback is not proof that authenticated API loading works; report which source was exercised and rely on deterministic tests for the full matrix.

Update README with the chosen version, module boundary, error/fallback policy, timeout/retry/page limits, environment defaults, and test command. Report remaining baseline failures accurately. Review the final diff for unrelated edits. Do not deploy or commit unless separately requested.

## Definition of done

The Printify workflow uses Effect for I/O, typed failures, validation, retries, cancellation, and dependency injection. Existing consumers and presentation still work. Tests cover successful and degraded source paths without network access. Checks/build pass or any unrelated baseline limitations are explicitly evidenced. Tokens and the Effect pipeline remain outside browser output.

## References for implementation

- [Effect v3 installation](https://effect.website/docs/v3/getting-started/installation)
- [Effect v3 retrying](https://effect.website/docs/v3/error-management/retrying)
- [Effect v3 Schema introduction](https://effect.website/docs/v3/schema/introduction)
- [Effect 4.0 release-candidate status](https://effect.website/blog/releases/effect/40-rc)

These sources establish library/version guidance. The file layout, limits, and migration steps above are project-specific design decisions.
