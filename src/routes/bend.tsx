import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import ProductList from "../components/ProductList";
import { pageMetadata } from "../lib/page-metadata";
import { styles } from "../styles/storefront.stylex";

export const Route = createFileRoute("/bend")({
  staticData: { fixedViewportHeight: true },
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/bend", title: "Bend — utxowear" }),
  component: BendPage,
});

function BendPage() {
  return (
    <section id="shop" aria-label="Products" {...stylex.props(styles.catalogSection)}>
      <ProductList layout="stacked" />
    </section>
  );
}
