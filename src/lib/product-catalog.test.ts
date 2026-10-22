import { describe, expect, test } from "bun:test";
import type { StoreProduct } from "./printify/model";
import { emptyFilters, filterProducts, optionValues } from "./product-catalog";

const shirt: StoreProduct = {
  id: "shirt",
  title: "Canvas shirt",
  description: "Organic cotton",
  currency: "USD",
  price: 2000,
  mockups: [],
  defaultVariantId: 1,
  variants: [
    {
      id: 1,
      title: "Small black",
      price: 2000,
      options: [
        { name: "Size", value: "S" },
        { name: "Color", value: "Black" },
      ],
    },
    {
      id: 2,
      title: "Large white",
      price: 3000,
      options: [
        { name: "Size", value: "L" },
        { name: "Color", value: "White" },
      ],
    },
  ],
};
const hat: StoreProduct = {
  ...shirt,
  id: "hat",
  title: "Studio hat",
  description: "Wool",
  price: 1500,
  variants: [],
  defaultVariantId: null,
};

describe("product discovery", () => {
  test("decimal price bounds include products at the exact price", () => {
    const product = { ...hat, price: 1985 };
    expect(
      filterProducts([product], { ...emptyFilters, minPrice: "19.85", maxPrice: "19.85" }),
    ).toEqual([product]);
  });

  test("search matches words across product details without case sensitivity", () => {
    expect(filterProducts([shirt, hat], { ...emptyFilters, query: "  COTTON canvas " })).toEqual([
      shirt,
    ]);
    expect(filterProducts([shirt, hat], { ...emptyFilters, query: "missing" })).toEqual([]);
  });

  test("size, color, and price must match the same variant", () => {
    expect(filterProducts([shirt], { ...emptyFilters, size: "S", color: "White" })).toEqual([]);
    expect(filterProducts([shirt], { ...emptyFilters, size: "L", maxPrice: "25" })).toEqual([]);
    expect(
      filterProducts([shirt], {
        ...emptyFilters,
        size: "L",
        color: "White",
        minPrice: "30",
        maxPrice: "30",
      }),
    ).toEqual([shirt]);
  });

  test("preview-only products respect price filters and cannot match variant options", () => {
    expect(filterProducts([hat], { ...emptyFilters, maxPrice: "15" })).toEqual([hat]);
    expect(filterProducts([hat], { ...emptyFilters, color: "Black" })).toEqual([]);
    expect(
      filterProducts([shirt, hat], { ...emptyFilters, minPrice: "40", maxPrice: "10" }),
    ).toEqual([]);
  });

  test("recognizes Printify option labels and orders clothing sizes", () => {
    const product = {
      ...shirt,
      variants: shirt.variants.map((variant) => ({
        ...variant,
        options: variant.options.map((option) => ({
          ...option,
          name: option.name === "Size" ? "Clothing sizes" : "Comfort Colors® Colors",
        })),
      })),
    };
    expect(optionValues([product], "size")).toEqual(["S", "L"]);
    expect(optionValues([product], "color")).toEqual(["Black", "White"]);
    expect(filterProducts([product], { ...emptyFilters, size: "L", color: "White" })).toEqual([
      product,
    ]);
  });

  test("sorts without mutating the catalog and extracts actual option values", () => {
    const products = [shirt, hat];
    expect(filterProducts(products, { ...emptyFilters, sort: "price-asc" })).toEqual([hat, shirt]);
    expect(filterProducts(products, { ...emptyFilters, sort: "price-desc" })).toEqual([shirt, hat]);
    expect(filterProducts(products, { ...emptyFilters, sort: "name" })).toEqual([shirt, hat]);
    expect(products).toEqual([shirt, hat]);
    expect(optionValues([shirt, shirt], "color")).toEqual(["Black", "White"]);
    expect(filterProducts([], emptyFilters)).toEqual([]);
  });
});
