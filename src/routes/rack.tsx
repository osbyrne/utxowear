import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import RackCatalog from "../components/RackCatalog";
import { pageMetadata } from "../lib/page-metadata";
import { styles } from "../styles/storefront.stylex";

export const Route = createFileRoute("/rack")({
  staticData: { fixedViewportHeight: true },
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/rack", title: "Rack — utxowear" }),
  component: RackPage,
});

function RackPage() {
  return (
    <section id="shop" aria-label="Shirts" {...stylex.props(styles.catalogSection)}>
      <RackCatalog />
    </section>
  );
}
