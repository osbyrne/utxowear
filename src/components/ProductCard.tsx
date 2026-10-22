import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct, StoreVariant } from "../lib/printify/model";
import { styles } from "../styles/storefront.stylex";

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
}: {
  product: StoreProduct;
  onAdd: (product: StoreProduct, variant: StoreVariant, quantity: number) => void;
}) {
  const [variantId, setVariantId] = useState(product.defaultVariantId ?? product.variants[0]?.id);
  const [quantity, setQuantity] = useState(1);
  const variant = product.variants.find((candidate) => candidate.id === variantId);
  const purchasable =
    (product.currency === "USD" || product.currency === "EUR") &&
    !product.checkoutUnavailableReason &&
    Boolean(variant);

  return (
    <article {...stylex.props(styles.card)}>
      <figure {...stylex.props(styles.figure)}>
        <img
          {...stylex.props(styles.image)}
          src={variant?.image ?? product.mockups[0]}
          alt={`${product.title}${variant ? ` — ${variant.title}` : ""}`}
          loading="lazy"
        />
      </figure>
      <div {...stylex.props(styles.productBody)}>
        <div {...stylex.props(styles.productHeading)}>
          <h3 {...stylex.props(styles.productTitle)}>{product.title}</h3>
          <span {...stylex.props(styles.price)}>
            {money(variant?.price ?? product.price, product.currency)}
          </span>
        </div>
        <p {...stylex.props(styles.description)}>
          {product.description || "Printify-made / unisex fit"}
        </p>
        {purchasable ? (
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
                    {choice.options.length
                      ? choice.options.map(({ name, value }) => `${name}: ${value}`).join(" / ")
                      : choice.title}{" "}
                    — {money(choice.price, product.currency)}
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
        ) : (
          <p {...stylex.props(styles.unavailable)}>
            {product.checkoutUnavailableReason ??
              "Preview only — this item is not available for checkout."}
          </p>
        )}
      </div>
    </article>
  );
}
