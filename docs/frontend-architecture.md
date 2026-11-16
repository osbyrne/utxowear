# Frontend architecture

React renders the complete storefront through TanStack Start. TanStack Router
owns the document, navigation, page metadata, route loading, and HTTP endpoints.
The Cloudflare Vite plugin runs the application in Workers during development,
preview, and production. TypeScript checks the frontend and server together.

## Boundaries

- `src/routes/__root.tsx` owns the document, shared styles, header, footer, and bag provider.
- `src/routes/` contains the homepage, product details, bag, information pages, and API routes.
- `src/components/` contains React UI, including the catalog, galleries, contact form, and 3D view.
- `src/lib/storefront.ts` exposes the server catalog function. Its implementation reads Worker bindings and invokes the existing Effect catalog service.
- `src/lib/printify/` owns catalog validation, publication, sanitization, transport, and retries.
- `src/lib/checkout/` retains payment validation, shipping, fulfillment, and the D1 ledger.
- `src/routeTree.gen.ts` is generated from route files. Commit it; do not edit it manually.

The browser receives normalized public product data. Printify and Stripe keys,
the contact recipient, and fulfillment operations remain on the server. Existing
`/api/shipping`, `/api/checkout`, `/api/contact`, and webhook URLs retain their
request and response contracts.

## Rendering and loading

The homepage renders its shell immediately and loads the full catalog through a
TanStack server function after hydration. Product and bag loaders use that same
server function. The product loader finds the requested product before rendering
its title and image metadata, and returns an HTTP 404 for missing products.
It passes the loaded catalog to the detail UI without a second catalog request.

The `/bend` route is an alternate catalog. It sets `staticData.fixedViewportHeight`,
so the root shell occupies exactly the viewport height. It stacks products in one
column inside the canvasui `Bend` component (`src/components/canvasui/Bend.tsx`),
which scrolls internally and folds its top and bottom edges. Bend draws through the
browser's HTML-in-canvas API where available and otherwise renders an ordinary
scrolling list. HTML-in-canvas omits cross-origin images without CORS, so product
images in this layout load in CORS mode. They also load eagerly, because native lazy
loading has no look-ahead margin inside an internal scroller. The homepage keeps
the responsive product grid.

The `/products` route is a second alternate catalog. It also sets
`staticData.fixedViewportHeight` and hangs the product grid from the top edge of the
canvasui `Cloth` component (`src/components/canvasui/Cloth.tsx`), which ripples in the
wind and responds to the cursor. The grid scrolls inside its own container, because
`Cloth` clips its content to a box whose height comes from its parent. Like Bend,
Cloth needs the browser's HTML-in-canvas API and otherwise renders the same grid as
ordinary HTML, so its images also load in CORS mode.

The `/panel` route shows one strip per shirt using the DiMaac `ExpandablePanel`
(`src/components/dimaac/ExpandablePanel.tsx`), which GSAP animates. The component
was ported from Tailwind to StyleX, and its stacked layout follows the viewport
width. The strips open on hover, focus, or tap; the selected shirt's name, price,
and product link appear below them. The panel and GSAP load through a lazy import
after the catalog arrives, and `useCatalog` supplies the catalog request shared
with the homepage.

The `/rack` route shows the shirts on the DiMaac `ClothesRack`
(`src/components/dimaac/ClothesRack.tsx` and its `clothes-rack/` modules), a three.js
rail of procedurally modeled garments. These are not the Printify mockups: each product
is drawn as a white tee with its title set on the chest, and the detail view's button
opens the real product page. The component was ported from Tailwind to StyleX and
loads through a lazy import after the catalog arrives, so three.js stays out of
server rendering. It uses no external textures; the cloth weave is drawn in code.

`DeferredCheckout` loads the interactive catalog, product controls, and bag code
through a React lazy import and Suspense boundary. Loading UI reports slow
requests after 15 seconds. Failure UI provides a reload link. The 3D view remains
on `/3d-shirt`, linked only from the footer, with its browser-only model and
rendering code behind a separate lazy import.

`CartProvider` owns the in-memory bag across route changes. Effect Schema validates
saved lines when reading local storage, and the checkout component reconciles them
with the current purchasable variants. The header reads the same React state.
Storage failure leaves the in-memory bag usable. The server still independently
validates prices, currency, variants, destination, and fulfillment state.

## Migration choices

TanStack Start provides server rendering and Workers integration without a
separate HTML-rendering server. A browser-only Vite application would require
additional handling for product previews and server 404 responses. Keeping Astro
as the page shell would leave part of the frontend outside React.

The migration keeps StyleX, the existing product UI, and Effect services.
No table or additional query library is needed for this storefront. Route loaders
handle server data for product and bag pages; the homepage has one cancellable
catalog request with explicit loading, success, and failure states.

## Build and release

`bun dev` starts Vite and the local Worker on port 4321. `bun run build` produces
browser assets in `dist/client` and the Worker in `dist/server`. The generated
`dist/server/wrangler.json` remains the deployment artifact checked by
`scripts/deploy.ts`. Preview and production retain their separate resources,
fulfillment modes, and release restrictions. Vite resolves `CLOUDFLARE_ENV` while
building; deployment uses that resolved configuration.
