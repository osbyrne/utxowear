import { lazy } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import DeferredContent from "./DeferredContent";
import ProductLoading from "./ProductLoading";

const Checkout = lazy(() => import("./Checkout"));

export type CatalogLayout = "grid" | "stacked" | "suspended";

type CheckoutView =
  | { kind: "catalog"; layout?: CatalogLayout }
  | { kind: "bag" }
  | { kind: "product"; productId: string };

export default function DeferredCheckout({
  products,
  view,
}: {
  products: StoreProduct[];
  view: CheckoutView;
}) {
  const reloadPath =
    view.kind === "product"
      ? `/products/${encodeURIComponent(view.productId)}`
      : view.kind === "bag"
        ? "/cart"
        : view.layout === "stacked"
          ? "/bend"
          : view.layout === "suspended"
            ? "/products"
            : "/";
  return (
    <DeferredContent
      loadingFallback={
        <ProductLoading
          detail={view.kind === "product"}
          reloadPath={reloadPath}
          layout={view.kind === "catalog" ? view.layout : undefined}
        />
      }
      errorFallback={
        <p role="alert" {...stylex.props(styles.error)}>
          {view.kind === "product" ? "Product details could not load." : "Products could not load."}{" "}
          <a href={reloadPath}>Reload</a>
        </p>
      }
    >
      <Checkout
        products={products}
        bag={view.kind === "bag"}
        productId={view.kind === "product" ? view.productId : undefined}
        layout={view.kind === "catalog" ? view.layout : undefined}
      />
    </DeferredContent>
  );
}
