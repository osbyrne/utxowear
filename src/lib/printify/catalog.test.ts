import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { makeCatalog } from "./catalog";
import { makeFetchLayer, type FetchImplementation } from "./client";
import { normalizePrintifyConfig } from "./model";

const config = normalizePrintifyConfig({ token: "test-token", shopId: "123" }).config;
const product = {
  id: "published-product",
  title: "Published shirt",
  visible: true,
  external: { id: "external-id" },
  images: [{ src: "https://example.com/shirt.png", position: "front", is_default: true }],
  variants: [{ id: 1, title: "M", price: 2000, is_enabled: true, is_default: true, options: [] }],
};
const run = (fetch: FetchImplementation) =>
  Effect.runPromise(
    makeCatalog(config, { log: () => undefined }).pipe(Effect.provide(makeFetchLayer(fetch))),
  );

test("the authenticated catalog loads all pages and lists published products while hiding drafts and unpublished items", async () => {
  const products = await run(async (url) => {
    if (url.endsWith("/shops.json")) return Response.json([{ id: 123, title: "utxowear" }]);
    const page = Number(new URL(url).searchParams.get("page"));
    return Response.json({
      current_page: page,
      last_page: 2,
      data:
        page === 1
          ? [product, { ...product, id: "draft", external: { id: "" } }]
          : [
              { ...product, id: "published-update", is_locked: true },
              { ...product, id: "unpublished", visible: false },
            ],
    });
  });
  expect(products.map((product) => product.id)).toEqual(["published-product", "published-update"]);
  expect(products[0]?.variants[0]).toMatchObject({ id: 1, price: 2000 });
});

test("empty catalogs and API failures never resurrect fallback products", async () => {
  for (const failed of [false, true]) {
    const products = await run(async (url) => {
      if (!url.startsWith("https://api.printify.com/"))
        throw new Error("Must not use public fallback");
      if (failed) return new Response("Unauthorized", { status: 401 });
      if (url.endsWith("/shops.json")) return Response.json([{ id: 123, title: "utxowear" }]);
      return Response.json({
        current_page: 1,
        last_page: 1,
        data: [{ ...product, external: { id: "" } }],
      });
    });
    expect(products).toEqual([]);
  }
});
