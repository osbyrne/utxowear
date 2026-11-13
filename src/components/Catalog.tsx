import * as stylex from "@stylexjs/stylex";
import type { StoreProduct, StoreVariant } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import { Bend } from "./canvasui/Bend";
import ProductCard from "./ProductCard";

export default function Catalog({
  products,
  onAdd,
  layout = "grid",
}: {
  products: StoreProduct[];
  onAdd: (product: StoreProduct, variant: StoreVariant, quantity: number) => void;
  layout?: "grid" | "stacked";
}) {
  if (!products.length) {
    return (
      <div {...stylex.props(styles.emptyCatalog)}>
        <p>No products available yet.</p>
      </div>
    );
  }
  if (layout === "stacked") {
    return (
      <Bend {...stylex.props(styles.catalogViewport)} zone={180} rounding={120}>
        <div {...stylex.props(styles.productStack)}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onAdd={onAdd} drawable />
          ))}
        </div>
      </Bend>
    );
  }
  return (
    <div {...stylex.props(styles.productGrid)}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAdd={onAdd} />
      ))}
    </div>
  );
}
