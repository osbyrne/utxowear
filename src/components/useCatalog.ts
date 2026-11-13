import { useEffect, useState } from "react";
import type { StoreProduct } from "../lib/printify/model";
import { loadCatalog } from "../lib/storefront";

export type CatalogState =
  | { kind: "loading" }
  | { kind: "ready"; products: StoreProduct[] }
  | { kind: "failed" };

/** Loads the public catalog after hydration; the request is cancelled on unmount. */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    loadCatalog({ signal: controller.signal }).then(
      (products) => {
        if (!controller.signal.aborted) setState({ kind: "ready", products });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: "failed" });
      },
    );
    return () => controller.abort();
  }, []);
  return state;
}
