import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import DeferredCheckout, { type CatalogLayout } from "./DeferredCheckout";
import ProductLoading from "./ProductLoading";
import { useCatalog } from "./useCatalog";

export default function ProductList({ layout = "grid" }: { layout?: CatalogLayout }) {
  const reloadPath = layout === "stacked" ? "/bend" : layout === "suspended" ? "/products" : "/";
  const state = useCatalog();

  switch (state.kind) {
    case "loading":
      return <ProductLoading reloadPath={reloadPath} layout={layout} />;
    case "failed":
      return (
        <p role="alert" {...stylex.props(styles.error)}>
          Products could not load. <a href={reloadPath}>Reload</a>
        </p>
      );
    case "ready":
      return <DeferredCheckout products={state.products} view={{ kind: "catalog", layout }} />;
  }
}
