import { lazy, type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import DeferredContent from "./DeferredContent";

const Checkout = lazy(() => import("./Checkout"));

export default function DeferredProductDetails({
  products,
  productId,
  children,
}: {
  products: StoreProduct[];
  productId: string;
  children: ReactNode;
}) {
  return (
    <DeferredContent
      loadingFallback={children}
      errorFallback={
        <p role="alert" {...stylex.props(styles.error)}>
          Product details could not load.{" "}
          <a href={`/products/${encodeURIComponent(productId)}`}>Reload</a>
        </p>
      }
    >
      <Checkout products={products} productId={productId} />
    </DeferredContent>
  );
}
