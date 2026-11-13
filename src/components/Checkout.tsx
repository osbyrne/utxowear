import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import type { StoreProduct, StoreVariant } from "../lib/printify/model";
import Catalog from "./Catalog";
import ProductCard from "./ProductCard";
import { money } from "./ProductCard";
import { styles } from "../styles/storefront.stylex";
import { validateAmount, type Currency } from "../lib/checkout/domain";
import { countryCodes } from "../lib/countries";
import { useCart, type CartLine } from "./CartProvider";
import { FlameWrap } from "./canvasui/FlameWrap";

type Address = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  country: string;
  region: string;
  address1: string;
  address2: string;
  city: string;
  zip: string;
};
type ShippingOption = { method: number; label: string; price: number; currency: Currency };
type ShippingQuote = { options: ShippingOption[]; currency: Currency; subtotal: number };

const emptyAddress: Address = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  country: "",
  region: "",
  address1: "",
  address2: "",
  city: "",
  zip: "",
};
async function postJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Checkout service is unavailable. Please try again later.");
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Checkout service is unavailable. Please try again later.";
    throw new Error(message);
  }
  return body as T;
}

function CartQuantity({
  line,
  title,
  variantTitle,
  onUpdate,
  onEdit,
}: {
  line: CartLine;
  title: string;
  variantTitle: string;
  onUpdate: (productId: string, variantId: number, quantity: number) => boolean;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState(String(line.quantity));
  useEffect(() => setDraft(String(line.quantity)), [line.quantity]);

  return (
    <label {...stylex.props(styles.field)}>
      <span>Quantity</span>
      <input
        {...stylex.props(styles.input, styles.cartQuantity)}
        aria-label={`${title}, ${variantTitle} quantity`}
        type="number"
        min="0"
        max="20"
        step="1"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onEdit();
        }}
        onBlur={() => {
          const quantity = Number(draft);
          if (draft !== "" && Number.isInteger(quantity) && quantity >= 0 && quantity <= 20) {
            if (quantity !== line.quantity && !onUpdate(line.productId, line.variantId, quantity))
              setDraft(String(line.quantity));
          } else {
            setDraft(String(line.quantity));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

const addressFields: {
  key: keyof Address;
  label: string;
  autoComplete: string;
  required?: boolean;
  type?: string;
}[] = [
  { key: "first_name", label: "First name", autoComplete: "given-name", required: true },
  { key: "last_name", label: "Last name", autoComplete: "family-name", required: true },
  { key: "email", label: "Email", autoComplete: "email", type: "email", required: true },
  { key: "phone", label: "Phone", autoComplete: "tel", type: "tel", required: true },
  { key: "country", label: "Country", autoComplete: "country", required: true },
  { key: "region", label: "State / province", autoComplete: "address-level1" },
  { key: "address1", label: "Street address", autoComplete: "address-line1", required: true },
  { key: "address2", label: "Apartment / suite", autoComplete: "address-line2" },
  { key: "city", label: "City", autoComplete: "address-level2", required: true },
  { key: "zip", label: "Postal code", autoComplete: "postal-code", required: true },
];

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryOptions = countryCodes
  .map((code) => ({ code, name: countryNames.of(code) ?? code }))
  .sort((first, second) => first.name.localeCompare(second.name, "en"));

export default function Checkout({
  products,
  bag = false,
  productId,
  layout,
}: {
  products: StoreProduct[];
  bag?: boolean;
  productId?: string;
  layout?: "grid" | "stacked";
}) {
  const { cart, setCart, cartLoaded } = useCart();
  const { searchStr } = useLocation();
  const [address, setAddress] = useState<Address>(emptyAddress);
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [shippingMethod, setShippingMethod] = useState<number | null>(null);
  const [pending, setPending] = useState<"shipping" | "checkout" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const quoteRequest = useRef<AbortController | null>(null);
  const checkoutRequest = useRef<AbortController | null>(null);
  const cartCurrencies = new Set(
    cart.map((line) => products.find((product) => product.id === line.productId)?.currency),
  );
  const currency = cartCurrencies.size === 1 ? [...cartCurrencies][0] : undefined;
  const validCartCurrency = currency === "USD" || currency === "EUR";

  useEffect(() => {
    if (!cartLoaded) return;
    const available = new Set(
      products
        .filter((product) => !product.checkoutUnavailableReason)
        .flatMap((product) => product.variants.map((variant) => `${product.id}:${variant.id}`)),
    );
    setCart((lines) => {
      const retained = lines.filter((line) => available.has(`${line.productId}:${line.variantId}`));
      return retained.length === lines.length ? lines : retained;
    });
  }, [products, cartLoaded, setCart]);

  useEffect(() => {
    const status = new URLSearchParams(searchStr).get("checkout");
    if (status === "success") {
      setNotice(
        "Returned from payment. Fulfillment starts only after Stripe confirms payment; keep your payment receipt for support.",
      );
    }
    if (status === "cancel") setNotice("Checkout was canceled. You can start again from the bag.");
  }, [searchStr]);

  useEffect(() => {
    return () => {
      quoteRequest.current?.abort();
      checkoutRequest.current?.abort();
    };
  }, []);

  function invalidateQuote() {
    quoteRequest.current?.abort();
    quoteRequest.current = null;
    checkoutRequest.current?.abort();
    checkoutRequest.current = null;
    if (pending !== null) setPending(null);
    setQuote(null);
    setShippingMethod(null);
    setError("");
  }

  function add(product: StoreProduct, variant: StoreVariant, quantity: number) {
    if (product.checkoutUnavailableReason || (cart.length && currency !== product.currency)) {
      setError("Your bag must contain items in a single available currency.");
      return;
    }
    const old = cart.find((line) => line.productId === product.id && line.variantId === variant.id);
    const total = cart.reduce((sum, line) => sum + line.quantity, 0);
    if (
      (!old && cart.length >= 12) ||
      total + quantity > 50 ||
      (old && old.quantity + quantity > 20)
    ) {
      setError("Your bag supports up to 12 variants, 20 of each, and 50 items total.");
      return;
    }
    setCart((lines) =>
      old
        ? lines.map((line) =>
            line.productId === product.id && line.variantId === variant.id
              ? { ...line, quantity: line.quantity + quantity }
              : line,
          )
        : [...lines, { productId: product.id, variantId: variant.id, quantity }],
    );
    invalidateQuote();
    setNotice(`${product.title} (${variant.title}) added to bag.`);
  }

  function updateCart(productId: string, variantId: number, quantity: number): boolean {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20) return false;
    if (
      cart.reduce(
        (sum, line) =>
          sum +
          (line.productId === productId && line.variantId === variantId ? quantity : line.quantity),
        0,
      ) > 50
    ) {
      setError("Your bag supports at most 50 items total.");
      return false;
    }
    setCart((lines) =>
      lines
        .map((line) =>
          line.productId === productId && line.variantId === variantId
            ? { ...line, quantity }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
    invalidateQuote();
    return true;
  }

  async function requestQuote(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!cart.length || !validCartCurrency) {
      setError("Your bag must contain items in a single available currency.");
      return;
    }
    const controller = new AbortController();
    quoteRequest.current = controller;
    setPending("shipping");
    setError("");
    setNotice("");
    setQuote(null);
    setShippingMethod(null);
    try {
      const result = await postJson<ShippingQuote>(
        "/api/shipping",
        { items: cart, address, currency },
        controller.signal,
      );
      if (quoteRequest.current !== controller) return;
      if (
        result.currency !== currency ||
        !validateAmount(result.subtotal) ||
        !Array.isArray(result.options) ||
        result.options.some(
          (option) =>
            option.currency !== result.currency ||
            !validateAmount(option.price) ||
            ![1, 2, 3, 4].includes(option.method) ||
            typeof option.label !== "string",
        )
      )
        throw new Error("Shipping quote is unavailable. Please try again later.");
      setQuote(result);
      setShippingMethod(result.options[0]?.method ?? null);
      if (result.options.length === 0)
        setError("No shipping methods are available for this address.");
    } catch (cause) {
      if (quoteRequest.current === controller)
        setError(
          cause instanceof Error
            ? cause.message
            : "Shipping quote is unavailable. Please try again later.",
        );
    } finally {
      if (quoteRequest.current === controller) {
        quoteRequest.current = null;
        setPending(null);
      }
    }
  }

  async function startCheckout() {
    const shipping = quote?.options.find((option) => option.method === shippingMethod);
    if (!quote || !shipping || shippingMethod === null || pending || quote.currency !== currency)
      return;
    const controller = new AbortController();
    checkoutRequest.current = controller;
    setPending("checkout");
    setError("");
    try {
      const result = await postJson<{ url: string }>(
        "/api/checkout",
        {
          items: cart,
          address,
          shippingMethod,
          currency: quote.currency,
          expectedTotal: quote.subtotal + shipping.price,
        },
        controller.signal,
      );
      if (checkoutRequest.current !== controller) return;
      const destination = new URL(result.url);
      if (
        destination.protocol !== "https:" ||
        !["checkout.stripe.com", "pay.stripe.com"].includes(destination.hostname)
      ) {
        throw new Error("Invalid payment destination. Please try again later.");
      }
      window.location.assign(destination.href);
    } catch (cause) {
      if (checkoutRequest.current === controller) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Checkout is unavailable. Please try again later.",
        );
        setPending(null);
      }
    } finally {
      if (checkoutRequest.current === controller) checkoutRequest.current = null;
    }
  }

  const selectedShipping = quote?.options.find((option) => option.method === shippingMethod);
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const localSubtotal = cart.reduce((total, line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return (
      total +
      (product?.variants.find((variant) => variant.id === line.variantId)?.price ?? 0) *
        line.quantity
    );
  }, 0);

  return (
    <>
      <span hidden data-storefront-ready={cartLoaded ? "true" : undefined} />
      {!bag &&
        (productId ? (
          products
            .filter((product) => product.id === productId)
            .map((product) => <ProductCard key={product.id} product={product} onAdd={add} detail />)
        ) : (
          <Catalog products={products} onAdd={add} layout={layout} />
        ))}
      {!bag && notice && (
        <p {...stylex.props(styles.notice)} role="status">
          {notice} <Link to="/cart">View bag</Link>
        </p>
      )}
      {!bag && error && (
        <p {...stylex.props(styles.error)} role="alert">
          {error}
        </p>
      )}
      {bag && (
        <section id="cart" {...stylex.props(styles.checkoutPanel)} aria-labelledby="cart-title">
          <h1 id="cart-title" {...stylex.props(styles.checkoutHeading)}>
            Your bag
          </h1>
          {cartLoaded && cart.length === 0 && (
            <p>
              Your bag is empty. <Link to="/">Browse products</Link>
            </p>
          )}
          {notice && (
            <p {...stylex.props(styles.notice)} role="status">
              {notice}
            </p>
          )}
          {cart.length > 0 && (
            <>
              <ul {...stylex.props(styles.cartLines)}>
                {cart.map((line) => {
                  const product = products.find((candidate) => candidate.id === line.productId);
                  const variant = product?.variants.find(
                    (candidate) => candidate.id === line.variantId,
                  );
                  if (!product || !variant) return null;
                  return (
                    <li
                      key={`${line.productId}:${line.variantId}`}
                      {...stylex.props(styles.cartLine)}
                    >
                      <div>
                        <strong>{product.title}</strong>
                        <br />
                        <span {...stylex.props(styles.muted)}>
                          {variant.options
                            .map(({ name, value }) => `${name}: ${value}`)
                            .join(" / ") || variant.title}
                        </span>
                      </div>
                      <CartQuantity
                        line={line}
                        title={product.title}
                        variantTitle={variant.title}
                        onUpdate={updateCart}
                        onEdit={invalidateQuote}
                      />
                      <span>{money(variant.price * line.quantity, product.currency)}</span>
                      <button
                        type="button"
                        {...stylex.props(styles.removeButton)}
                        onClick={() => updateCart(line.productId, line.variantId, 0)}
                        aria-label={`Remove ${product.title}, ${variant.title}`}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p {...stylex.props(styles.totalRow)}>
                <span>
                  Subtotal ({itemCount} {itemCount === 1 ? "item" : "items"})
                </span>
                <strong>
                  {validCartCurrency
                    ? money(quote?.subtotal ?? localSubtotal, currency)
                    : "Mixed currencies — update your bag"}
                </strong>
              </p>
              {currency === "USD" && (
                <p {...stylex.props(styles.muted)}>
                  Prices and payments are in USD. Your card issuer handles currency conversion and
                  may charge exchange fees.
                </p>
              )}
              <form onSubmit={requestQuote} {...stylex.props(styles.checkoutForm)}>
                <h3 {...stylex.props(styles.formHeading)}>Delivery address</h3>
                <div {...stylex.props(styles.addressGrid)}>
                  {addressFields.map((field) => (
                    <label key={field.key} {...stylex.props(styles.field)}>
                      <span>{field.label}</span>
                      {field.key === "country" ? (
                        <select
                          {...stylex.props(styles.input)}
                          name="country"
                          autoComplete="country"
                          value={address.country}
                          required
                          onChange={(event) => {
                            setAddress((previous) => ({
                              ...previous,
                              country: event.target.value,
                            }));
                            invalidateQuote();
                          }}
                        >
                          <option value="">Select a country</option>
                          {countryOptions.map(({ code, name }) => (
                            <option key={code} value={code}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          {...stylex.props(styles.input)}
                          name={field.key}
                          type={field.type ?? "text"}
                          autoComplete={field.autoComplete}
                          value={address[field.key]}
                          required={field.required}
                          onChange={(event) => {
                            setAddress((previous) => ({
                              ...previous,
                              [field.key]: event.target.value,
                            }));
                            invalidateQuote();
                          }}
                        />
                      )}
                    </label>
                  ))}
                </div>
                <button
                  {...stylex.props(styles.primaryButton)}
                  type="submit"
                  disabled={pending !== null}
                >
                  {pending === "shipping"
                    ? "Getting shipping rates…"
                    : quote
                      ? "Update shipping rates"
                      : "Get shipping rates"}
                </button>
              </form>
              {quote && quote.options.length > 0 && (
                <div {...stylex.props(styles.shippingSection)}>
                  <h3 {...stylex.props(styles.formHeading)}>Shipping method</h3>
                  {quote.options.map((option) => (
                    <label key={option.method} {...stylex.props(styles.shippingChoice)}>
                      <input
                        type="radio"
                        name="shippingMethod"
                        checked={shippingMethod === option.method}
                        onChange={() => setShippingMethod(option.method)}
                      />
                      <span>{option.label}</span>
                      <strong>{money(option.price, quote.currency)}</strong>
                    </label>
                  ))}
                  <p {...stylex.props(styles.totalRow)}>
                    <span>Items</span>
                    <strong>{money(quote.subtotal, quote.currency)}</strong>
                  </p>
                  <p {...stylex.props(styles.totalRow)}>
                    <span>Shipping</span>
                    <strong>
                      {selectedShipping
                        ? money(selectedShipping.price, quote.currency)
                        : "Select a method"}
                    </strong>
                  </p>
                  <p {...stylex.props(styles.totalRow, styles.grandTotal)}>
                    <span>Estimated total before tax ({quote.currency})</span>
                    <strong>
                      {selectedShipping
                        ? money(quote.subtotal + selectedShipping.price, quote.currency)
                        : "—"}
                    </strong>
                  </p>
                  <p {...stylex.props(styles.muted)}>
                    Any applicable tax is calculated and shown at secure payment before you pay.
                  </p>
                </div>
              )}
              {error && (
                <p {...stylex.props(styles.error)} role="alert">
                  {error}
                </p>
              )}
              <FlameWrap
                {...stylex.props(styles.paymentEffect)}
                height={56}
                spread={8}
                radius={0}
                color={[1, 0.35, 0.08]}
                intensity={!quote || shippingMethod === null || pending !== null ? 0.15 : 0.65}
                melt={1}
                distortion={2}
                smoke={0.3}
              >
                <button
                  {...stylex.props(styles.primaryButton, styles.paymentButton)}
                  type="button"
                  disabled={!quote || shippingMethod === null || pending !== null}
                  onClick={startCheckout}
                >
                  {pending === "checkout"
                    ? "Opening secure payment…"
                    : "Continue to secure payment"}
                </button>
              </FlameWrap>
              {!quote && (
                <p {...stylex.props(styles.muted)}>
                  Checkout is disabled until shipping rates are available. If the service is
                  unavailable, please try again later; no payment or order is placed.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
