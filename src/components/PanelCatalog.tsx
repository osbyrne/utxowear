import { lazy } from "react";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import DeferredContent from "./DeferredContent";
import ProductLoading from "./ProductLoading";
import { useCatalog } from "./useCatalog";

const ShirtPanel = lazy(() => import("./ShirtPanel"));

export default function PanelCatalog() {
  const state = useCatalog();
  const loading = <ProductLoading reloadPath="/panel" layout="stacked" />;
  const failure = (message: string) => (
    <p role="alert" {...stylex.props(styles.error)}>
      {message} <a href="/panel">Reload</a>
    </p>
  );

  switch (state.kind) {
    case "loading":
      return loading;
    case "failed":
      return failure("Products could not load.");
    case "ready":
      return (
        <DeferredContent
          loadingFallback={loading}
          errorFallback={failure("The shirt panel could not load.")}
        >
          <ShirtPanel products={state.products} />
        </DeferredContent>
      );
  }
}
