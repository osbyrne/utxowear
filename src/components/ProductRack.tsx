import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import { ClothesRack, type ClothesRackItem } from "./dimaac/ClothesRack";

/** Draws a product as a white tee with its name set in stacked serif lines. */
function rackItem(product: StoreProduct): ClothesRackItem {
  const lines = product.title
    .replace(/\s+shirt$/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return {
    name: product.title,
    kind: "tee",
    colour: "#f2f2f3",
    print: { kind: "serif", lines, ink: "#1f1f24", tagline: "UTXOWEAR" },
  };
}

export default function ProductRack({ products }: { products: StoreProduct[] }) {
  const navigate = useNavigate();
  const items = useMemo(() => products.map(rackItem), [products]);

  if (!items.length) {
    return (
      <div {...stylex.props(styles.emptyCatalog)}>
        <p>No products available yet.</p>
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.catalogViewport)}>
      <ClothesRack
        items={items}
        selectLabel="View shirt"
        onSelect={(_item, index) => {
          const product = products[index];
          if (product) void navigate({ to: "/products/$id", params: { id: product.id } });
        }}
      />
    </div>
  );
}
