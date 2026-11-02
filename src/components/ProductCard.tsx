import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct, StoreVariant } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";
import "../styles/product-description.css";
import ProductGallery from "./ProductGallery";

const formatters = new Map<string, Intl.NumberFormat>();
export function money(cents: number, currency: string) {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}

export default function ProductCard({
  product,
  onAdd,
  detail = false,
}: {
  product: StoreProduct;
  detail?: boolean;
  onAdd: (product: StoreProduct, variant: StoreVariant, quantity: number) => void;
}) {
  const [variantId, setVariantId] = useState(product.defaultVariantId ?? product.variants[0]?.id);
  const [quantity, setQuantity] = useState(1);
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  const purchasable =
    (product.currency === "USD" || product.currency === "EUR") &&
    !product.checkoutUnavailableReason &&
    Boolean(variant);

  const productUrl = `/products/${encodeURIComponent(product.id)}`;
  const images = [...new Set([...(variant?.image ? [variant.image] : []), ...product.mockups])];
  return (
    <article
      id={`product-${product.id}`}
      {...stylex.props(styles.card, styles.cardLink, detail && styles.productDetail)}
    >
      <ProductGallery
        key={variantId ?? product.id}
        title={product.title}
        images={images}
        href={detail ? undefined : productUrl}
      />
      <div {...stylex.props(styles.productBody)}>
        <div {...stylex.props(styles.productHeading)}>
          {detail ? (
            <h1 {...stylex.props(styles.detailTitle)}>{product.title}</h1>
          ) : (
            <h3 {...stylex.props(styles.productTitle)}>
              <a href={productUrl} {...stylex.props(styles.productLink)}>
                {product.title}
              </a>
            </h3>
          )}
          <span {...stylex.props(styles.price)}>
            {money(variant?.price ?? product.price, product.currency)}
          </span>
        </div>
        {detail && (
          <div
            className="product-description"
            dangerouslySetInnerHTML={{
              __html: product.description || "Printify-made / unisex fit",
            }}
          />
        )}
        {detail && product.whitepaperUrl && (
          <a
            {...stylex.props(styles.primaryButton, styles.whitepaperButton)}
            href={product.whitepaperUrl}
            download
          >
            Download whitepaper
          </a>
        )}
        {detail && purchasable && (
          <div {...stylex.props(styles.productControls)}>
            <label {...stylex.props(styles.field)}>
              <span>Size / color</span>
              <select
                {...stylex.props(styles.input)}
                value={variantId}
                onChange={(event) => setVariantId(Number(event.target.value))}
              >
                {product.variants.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.options.map(({ name, value }) => `${name}: ${value}`).join(" / ") ||
                      choice.title}
                  </option>
                ))}
              </select>
            </label>
            <div {...stylex.props(styles.addRow)}>
              <label {...stylex.props(styles.field)}>
                <span>Quantity</span>
                <input
                  {...stylex.props(styles.input)}
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
              <button
                {...stylex.props(styles.primaryButton)}
                type="button"
                disabled={!Number.isInteger(quantity) || quantity < 1 || quantity > 20}
                onClick={() => variant && onAdd(product, variant, quantity)}
              >
                Add to bag
              </button>
            </div>
          </div>
        )}
        {!purchasable && (
          <p {...stylex.props(styles.unavailable)}>
            {product.checkoutUnavailableReason ??
              "Preview only — this item is not available for checkout."}
          </p>
        )}
      </div>
    </article>
  );
}
