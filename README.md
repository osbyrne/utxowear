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
