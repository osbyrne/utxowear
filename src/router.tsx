import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import ProductLoading from "./components/ProductLoading";
import RouteError from "./components/RouteError";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPendingComponent: () => <ProductLoading reloadPath="/" />,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: () => <h1>Page not found</h1>,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface StaticDataRouteOption {
    /** Bound the page to the viewport height; the route's content scrolls internally. */
    fixedViewportHeight?: boolean;
  }
}
