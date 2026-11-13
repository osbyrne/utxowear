import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import { useCart } from "./CartProvider";

export default function Header() {
  const { cart } = useCart();
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.navbar, styles.contentPadding)}>
        <div {...stylex.props(styles.brandArea)}>
          <Link to="/" {...stylex.props(styles.brand)} aria-label="utxowear home">
            utxowear
          </Link>
        </div>
        <nav aria-label="Main navigation" {...stylex.props(styles.navigation)}>
          <Link to="/about" {...stylex.props(styles.button, styles.navigationLink)}>
            About
          </Link>
          <Link to="/contact" {...stylex.props(styles.button, styles.navigationLink)}>
            Contact
          </Link>
          <Link
            to="/cart"
            data-cart-link
            {...stylex.props(styles.button, styles.navigationLink, styles.bag)}
            aria-label={`Shopping bag with ${count} ${count === 1 ? "item" : "items"}`}
          >
            Bag{" "}
            <span data-cart-count {...stylex.props(styles.badge)}>
              {count}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
