import type { StoreProduct, StoreVariant } from "./printify/model";

export type CatalogFilters = {
  query: string;
  size: string;
  color: string;
  minPrice: string;
  maxPrice: string;
  sort: string;
};

export const emptyFilters: CatalogFilters = {
  query: "",
  size: "",
  color: "",
  minPrice: "",
  maxPrice: "",
  sort: "featured",
};

function optionNameMatches(label: string, name: "size" | "color") {
  return (name === "size" ? /\bsizes?\b/i : /\bcolou?rs?\b/i).test(label);
}

function optionMatches(variant: StoreVariant, name: "size" | "color", value: string) {
  return (
    !value ||
    variant.options.some((option) => optionNameMatches(option.name, name) && option.value === value)
  );
}

export function optionValues(products: StoreProduct[], name: "size" | "color") {
  return [
    ...new Set(
      products.flatMap((product) =>
        product.variants.flatMap((variant) =>
          variant.options
            .filter((option) => optionNameMatches(option.name, name))
            .map((option) => option.value),
        ),
      ),
    ),
  ].sort((a, b) => {
    const sizes = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];
    if (name === "size" && sizes.includes(a) && sizes.includes(b)) {
      return sizes.indexOf(a) - sizes.indexOf(b);
    }
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

export function filterProducts(products: StoreProduct[], filters: CatalogFilters) {
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const min = filters.minPrice === "" ? 0 : Math.round(Number(filters.minPrice) * 100);
  const max = filters.maxPrice === "" ? Infinity : Math.round(Number(filters.maxPrice) * 100);
  const results = products.filter((product) => {
    const text = `${product.title} ${product.description} ${product.variants
      .map(
        (variant) => `${variant.title} ${variant.options.map((option) => option.value).join(" ")}`,
      )
      .join(" ")}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) return false;
    if (product.variants.length) {
      return product.variants.some(
        (variant) =>
          optionMatches(variant, "size", filters.size) &&
          optionMatches(variant, "color", filters.color) &&
          variant.price >= min &&
          variant.price <= max,
      );
    }
    return !filters.size && !filters.color && product.price >= min && product.price <= max;
  });
  if (filters.sort === "price-asc") results.sort((a, b) => a.price - b.price);
  if (filters.sort === "price-desc") results.sort((a, b) => b.price - a.price);
  if (filters.sort === "name") results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}
