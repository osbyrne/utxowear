import { lazy } from "react";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import DeferredContent from "./DeferredContent";
import ProductLoading from "./ProductLoading";
import { useCatalog } from "./useCatalog";

const ProductRack = lazy(() => import("./ProductRack"));

export default function RackCatalog() {
  const state = useCatalog();
  const loading = <ProductLoading reloadPath="/rack" layout="stacked" />;
  const failure = (message: string) => (
    <p role="alert" {...stylex.props(styles.error)}>
      {message} <a href="/rack">Reload</a>
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
          errorFallback={failure("The clothes rack could not load.")}
        >
          <ProductRack products={state.products} />
        </DeferredContent>
      );
  }
}
