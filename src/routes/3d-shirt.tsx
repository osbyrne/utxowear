import { createFileRoute } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import { pageMetadata } from "../lib/page-metadata";
import DeferredShirt from "../components/DeferredShirt";

export const Route = createFileRoute("/3d-shirt")({
  head: ({ match }) =>
    pageMetadata({ origin: match.context.origin, path: "/3d-shirt", title: "3D shirt — utxowear" }),
  component: ShirtPage,
});

function ShirtPage() {
  return (
    <section {...stylex.props(styles.preview)} aria-label="3D shirt preview">
      <DeferredShirt />
    </section>
  );
}
