# utxowear web site repository

## Printify products and mockups

The product grid reads published products and front mockups from
`https://utxowear.printify.me/` during the Astro build. To retrieve the full
mockup list through Printify's official API, copy `.env.example` to `.env` and
add a Personal Access Token created under **Printify → My Profile → Connections**.

`PRINTIFY_SHOP_ID` is optional. It is useful when the same Printify account owns
multiple shops; otherwise the integration matches the `utxowear` shop by name.
The token is only read in Astro server/build code and is never sent to browsers.

The build-time integration uses the exact stable `effect@3.22.2` release. The
Effect pipeline is kept out of browser code and is split into these boundaries:

- `src/lib/printify.ts` translates Astro environment variables and is the only
  Promise execution boundary.
- `src/lib/printify/model.ts` owns Effect Schema contracts, configuration, and
  tagged failures.
- `src/lib/printify/parsing.ts` owns Flight extraction and pure normalization.
- `src/lib/printify/client.ts` provides the injectable, cancellable GET client.
- `src/lib/printify/catalog.ts` orchestrates pagination, source precedence, and
  fallback behavior.

The public storefront is attempted first. With a nonblank token, the API then
loads the selected shop and all product pages sequentially; a complete API
result with usable products takes precedence. An API status, transport,
timeout, JSON/schema, shop-selection, or pagination failure discards all API
pages and falls back to usable public products. If neither remote source has a
usable catalog, the original local names use `/shirt_transparent.png`, USD,
and a price of 6400 minor units.

Each request attempt has a 10-second timeout and uses the storefront user agent.
Transport failures, timeouts, 408, 429, and 5xx statuses receive at most two
retries with jittered exponential delays starting at 250 ms. Valid
`Retry-After` headers are honored. Each complete public or API source operation
has a 60-second budget, and API pagination is sequential and capped at 100
pages; exceeding that cap fails the API source instead of publishing partial
pages. Diagnostics contain only source, error tag, status, and page metadata.

`PRINTIFY_STORE_URL` defaults to `https://utxowear.printify.me/` and
`PRINTIFY_CURRENCY` defaults to `USD`; invalid optional overrides are warned
about and replaced with those safe defaults. `PRINTIFY_API_TOKEN` and
`PRINTIFY_SHOP_ID` are optional.

## Commands

| Command               | Action                                           |
| :-------------------- | :----------------------------------------------- |
| `bun install`         | Installs dependencies                            |
| `bun dev`             | Starts local dev server at `localhost:4321`      |
| `bun run build`       | Build your production site to `./dist/`          |
| `bun preview`         | Preview your build locally, before deploying     |
| `bun test`            | Run deterministic Printify integration tests     |
| `bun astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `bun astro -- --help` | Get help using the Astro CLI                     |

## Styling

Component styles use [StyleX](https://stylexjs.com/). The official
`@stylexjs/unplugin` Vite plugin compiles styles and includes the generated CSS in
Astro's production stylesheet. The development-only stylesheet and HMR import in
`src/pages/index.astro` keep server-rendered styles up to date during `bun dev`.

- `src/styles/theme.stylex.ts` defines shared colors and typography.
- `src/styles/storefront.stylex.ts` defines the Astro storefront styles. Apply
  them with `stylex.attrs(...)`; keep compiler-only calls such as `stylex.create`
  and `stylex.defaultMarker` in TypeScript modules, outside Astro templates.
- React components use `stylex.props(...)`, with the 3D preview styles colocated
  in `src/components/Shirt.tsx`.
- `src/app.css` contains only the font import and a global reset, in a lower
  cascade layer than the generated component styles.

Use explicit border width, style, and color properties in StyleX definitions.
Run `bun check` and `bun build` to validate changes.
