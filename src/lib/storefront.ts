import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { getPrintifyProducts } from "./printify";

export const loadCatalog = createServerFn({ method: "GET" }).handler(() =>
  getPrintifyProducts(env),
);

export const requestOrigin = createIsomorphicFn()
  .server(() => getRequestUrl().origin)
  .client(() => window.location.origin);
