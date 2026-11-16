import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";

export default function Footer() {
  return (
    <footer id="about" {...stylex.props(styles.footer, styles.contentPadding)}>
      <div {...stylex.props(styles.footerRow)}>
        <p {...stylex.props(styles.footerBrand)}>utxowear</p>
        <div {...stylex.props(styles.copyright)}>
          <Link to="/3d-shirt" {...stylex.props(styles.productLink)}>
            3D shirt
          </Link>
          <Link to="/bend" {...stylex.props(styles.productLink)}>
            Bend
          </Link>
          <Link to="/products" {...stylex.props(styles.productLink)}>
            Cloth
          </Link>
          <Link to="/panel" {...stylex.props(styles.productLink)}>
            Panel
          </Link>
          <Link to="/rack" {...stylex.props(styles.productLink)}>
            Rack
          </Link>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
