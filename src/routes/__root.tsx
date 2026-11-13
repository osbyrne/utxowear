import { useEffect, type ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts, useMatches } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import { requestOrigin } from "../lib/storefront";
import { pageMetadata } from "../lib/page-metadata";
import { CartProvider } from "../components/CartProvider";
import Header from "../components/Header";
import Footer from "../components/Footer";
import RouteError from "../components/RouteError";
import "../app.css";
import "../styles/product-description.css";

export const Route = createRootRoute({
  beforeLoad: () => ({ origin: requestOrigin() }),
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      ...pageMetadata({ origin: match.context.origin, path: "/" }).meta,
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        sizes: "200x200",
        href: "/icons/light-mode-transparent.png",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "200x200",
        href: "/icons/dark-mode-transparent.png",
        media: "(prefers-color-scheme: dark)",
      },
      ...(import.meta.env.DEV ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }] : []),
    ],
  }),
  shellComponent: Document,
  component: Storefront,
  errorComponent: RouteError,
  notFoundComponent: () => <h1>Page not found</h1>,
});

function Document({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (import.meta.env.DEV) void import("virtual:stylex:css-only");
  }, []);
  return (
    <html lang="en">
      <head>
        <style href="storefront-cascade-order" precedence="reset">
          {"@layer reset;"}
        </style>
        <HeadContent />
      </head>
      <body {...stylex.props(styles.body)}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Storefront() {
  const fixedViewportHeight = useMatches({
    select: (matches) => matches.some((match) => match.staticData.fixedViewportHeight === true),
  });
  return (
    <CartProvider>
      <div {...stylex.props(styles.shell, fixedViewportHeight && styles.shellFixedHeight)}>
        <Header />
        <main
          {...stylex.props(
            styles.main,
            styles.contentPadding,
            fixedViewportHeight && styles.mainFixedHeight,
          )}
        >
          <Outlet />
        </main>
        <Footer />
      </div>
    </CartProvider>
  );
}
