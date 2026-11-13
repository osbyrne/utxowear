import { useState } from "react";
import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import { ExpandablePanel } from "./dimaac/ExpandablePanel";
import { money } from "./ProductCard";

export default function ShirtPanel({ products }: { products: StoreProduct[] }) {
  const shirts = products.filter((product) => product.mockups.length > 0);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = shirts[activeIndex];

  if (!active) {
    return (
      <div {...stylex.props(styles.emptyCatalog)}>
        <p>No products available yet.</p>
      </div>
    );
  }
  return (
    <>
      <div {...stylex.props(styles.catalogViewport)}>
        <ExpandablePanel
          panels={shirts.map((product) => ({
            image: product.mockups[0],
            alt: `${product.title} mockup`,
            title: product.title,
            caption: money(product.price, product.currency),
          }))}
          trigger="hover"
          expandedRatio={4}
          radius={0}
          onChange={setActiveIndex}
        />
      </div>
      <p aria-live="polite" {...stylex.props(styles.panelSelection)}>
        <span>{active.title}</span>
        <span>{money(active.price, active.currency)}</span>
        <Link to="/products/$id" params={{ id: active.id }} {...stylex.props(styles.productLink)}>
          View shirt
        </Link>
      </p>
    </>
  );
}
