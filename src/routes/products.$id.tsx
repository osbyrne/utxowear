import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import { loadCatalog } from "../lib/storefront";
import { pageMetadata } from "../lib/page-metadata";
import DeferredCheckout from "../components/DeferredCheckout";

export const Route = createFileRoute("/products/$id")({
  loader: async ({ params }) => {
    const products = await loadCatalog();
    const product = products.find((candidate) => candidate.id === params.id);
    if (!product) throw notFound();
    return { products, product };
  },
  head: ({ match, loaderData }) =>
    pageMetadata({
      origin: match.context.origin,
      path: match.pathname,
      title: `${loaderData?.product.title ?? "Product not found"} — utxowear`,
      previewImage: loaderData?.product.mockups[0]
        ? { src: loaderData.product.mockups[0], alt: loaderData.product.title }
        : undefined,
    }),
  notFoundComponent: () => <h1>Product not found</h1>,
  component: ProductPage,
});

function ProductPage() {
  const { products, product } = Route.useLoaderData();
  return (
    <>
      <div {...stylex.props(styles.catalogHeading)}>
        <Link to="/" {...stylex.props(styles.productLink)}>
          ← All products
        </Link>
      </div>
      <DeferredCheckout products={products} view={{ kind: "product", productId: product.id }} />
    </>
  );
}
