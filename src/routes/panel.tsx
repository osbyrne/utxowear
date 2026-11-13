import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import PanelCatalog from "../components/PanelCatalog";
import { pageMetadata } from "../lib/page-metadata";
import { styles } from "../styles/storefront.stylex";

export const Route = createFileRoute("/panel")({
  staticData: { fixedViewportHeight: true },
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/panel", title: "Panel — utxowear" }),
  component: PanelPage,
});

function PanelPage() {
  return (
    <section id="shop" aria-label="Shirts" {...stylex.props(styles.catalogSection)}>
      <PanelCatalog />
    </section>
  );
}
