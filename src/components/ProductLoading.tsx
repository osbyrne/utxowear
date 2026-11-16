import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import type { CatalogLayout } from "./DeferredCheckout";

export default function ProductLoading({
  detail = false,
  reloadPath,
  layout = "grid",
}: {
  detail?: boolean;
  reloadPath: string;
  layout?: CatalogLayout;
}) {
  const stacked = !detail && layout === "stacked";
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDelayed(true), 15_000);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <div {...stylex.props(styles.loadingContainer)}>
      <div {...stylex.props(styles.loadingStatus)}>
        <p role={delayed ? "alert" : "status"}>
          {delayed
            ? "Loading is taking longer than expected. Reload to try again."
            : detail
              ? "Loading product details…"
              : "Loading products…"}
        </p>
        <a href={reloadPath}>Reload</a>
      </div>
      <div
        aria-hidden="true"
        {...stylex.props(
          detail ? styles.productDetail : stacked ? styles.productStack : styles.productGrid,
        )}
      >
        {Array.from({ length: detail || stacked ? 2 : 4 }, (_, index) => (
          <div
            key={index}
            {...stylex.props(styles.productPlaceholder, stacked && styles.catalogPlaceholder)}
          />
        ))}
      </div>
      <noscript>Enable JavaScript to load {detail ? "product details" : "products"}.</noscript>
    </div>
  );
}
