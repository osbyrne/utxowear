import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct, StoreVariant } from "../lib/printify/model";
import {
  emptyFilters,
  filterProducts,
  optionValues,
  type CatalogFilters,
} from "../lib/product-catalog";
import { styles } from "../styles/storefront.stylex";
import ProductCard from "./ProductCard";

export default function Catalog({
  products,
  full,
  onAdd,
}: {
  products: StoreProduct[];
  full: boolean;
  onAdd: (product: StoreProduct, variant: StoreVariant, quantity: number) => void;
}) {
  const [filters, setFilters] = useState<CatalogFilters>(emptyFilters);
  const visible = full ? filterProducts(products, filters) : products.slice(0, 4);
  const sizes = optionValues(products, "size");
  const colors = optionValues(products, "color");
  const active = Object.entries(filters).some(
    ([key, value]) => value !== emptyFilters[key as keyof CatalogFilters],
  );
  function update(key: keyof CatalogFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <>
      {full && (
        <form
          role="search"
          aria-label="Search and filter products"
          {...stylex.props(styles.catalogFilters)}
          onSubmit={(event) => event.preventDefault()}
        >
          <label {...stylex.props(styles.field, styles.catalogSearch)}>
            <span>Search</span>
            <input
              {...stylex.props(styles.input)}
              type="search"
              placeholder="Search products…"
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
            />
          </label>
          {sizes.length > 0 && (
            <label {...stylex.props(styles.field)}>
              <span>Size</span>
              <select
                {...stylex.props(styles.input)}
                value={filters.size}
                onChange={(event) => update("size", event.target.value)}
              >
                <option value="">All sizes</option>
                {sizes.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          )}
          {colors.length > 0 && (
            <label {...stylex.props(styles.field)}>
              <span>Color</span>
              <select
                {...stylex.props(styles.input)}
                value={filters.color}
                onChange={(event) => update("color", event.target.value)}
              >
                <option value="">All colors</option>
                {colors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label {...stylex.props(styles.field)}>
            <span>Sort by</span>
            <select
              {...stylex.props(styles.input)}
              value={filters.sort}
              onChange={(event) => update("sort", event.target.value)}
            >
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name: A–Z</option>
            </select>
          </label>
        </form>
      )}
      {full && (
        <div {...stylex.props(styles.catalogResults)}>
          <p {...stylex.props(styles.count)} role="status" aria-live="polite">
            {`${visible.length} of ${products.length} products`}
          </p>
          {full && active && (
            <button
              type="button"
              {...stylex.props(styles.removeButton)}
              onClick={() => setFilters(emptyFilters)}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {visible.length ? (
        <div {...stylex.props(styles.productGrid)}>
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} onAdd={onAdd} />
          ))}
        </div>
      ) : (
        <div {...stylex.props(styles.emptyCatalog)}>
          <p>{products.length ? "No products match your search." : "No products available yet."}</p>
        </div>
      )}
      {!full && (
        <div {...stylex.props(styles.moreRow)}>
          <a href="/products" {...stylex.props(styles.primaryButton)}>
            More
          </a>
        </div>
      )}
    </>
  );
}
