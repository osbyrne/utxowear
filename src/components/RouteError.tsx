import { useLocation } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";

export default function RouteError() {
  const { pathname } = useLocation();
  return (
    <p role="alert" {...stylex.props(styles.error)}>
      This page could not load. <a href={pathname}>Reload</a>
    </p>
  );
}
