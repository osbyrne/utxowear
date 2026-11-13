import { createFileRoute } from "@tanstack/react-router";
import { loadCatalog } from "../lib/storefront";
import { pageMetadata } from "../lib/page-metadata";
import DeferredCheckout from "../components/DeferredCheckout";

export const Route = createFileRoute("/cart")({
  loader: () => loadCatalog(),
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/cart", title: "Your bag — utxowear" }),
  component: CartPage,
});

function CartPage() {
  const products = Route.useLoaderData();
  return <DeferredCheckout products={products} view={{ kind: "bag" }} />;
}
