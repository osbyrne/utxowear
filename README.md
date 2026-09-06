# utxowear web site repository

## Printify products and mockups

The product grid reads published products and front mockups from
`https://utxowear.printify.me/` during the Astro build. To retrieve the full
mockup list through Printify's official API, copy `.env.example` to `.env` and
add a Personal Access Token created under **Printify → My Profile → Connections**.

`PRINTIFY_SHOP_ID` is optional. It is useful when the same Printify account owns
multiple shops; otherwise the integration matches the `utxowear` shop by name.
The token is only read in Astro server/build code and is never sent to browsers.

## Commands

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `bun install`             | Installs dependencies                            |
| `bun dev`             | Starts local dev server at `localhost:4321`      |
| `bun build`           | Build your production site to `./dist/`          |
| `bun preview`         | Preview your build locally, before deploying     |
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
