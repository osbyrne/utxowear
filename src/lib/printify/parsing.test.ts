import { describe, expect, test } from "bun:test";

import { normalizePrintifyConfig, type PrintifyProduct, type PublicStoreProduct } from "./model";
import {
  chooseShop,
  extractJsonArray,
  extractPublicProducts,
  normalizeApiProducts,
  normalizePublicProduct,
  plainText,
} from "./parsing";

const config = normalizePrintifyConfig({
  storeUrl: "https://utxowear.printify.me/",
  currency: "EUR",
}).config;

const publicProduct: PublicStoreProduct = {
  id: 1,
  title: "Public shirt",
  description: "<strong>Heavy</strong>&nbsp; cotton",
  image: "https://cdn.example/public.png",
  externalId: "api-1",
  path: "/products/public-shirt",
  defaultVariant: { retailPrice: 6400 },
};

const apiProduct: PrintifyProduct = {
  id: "api-1",
  title: "API shirt",
  description: "<p>Heavy</p> cotton",
  visible: true,
  images: [
    {
      src: "back.png",
      position: "back",
      is_default: false,
    },
    {
      src: "front.png",
      position: "front",
      is_default: false,
    },
    {
      src: "default.png",
      position: "back",
      is_default: true,
    },
  ],
  variants: [
    { price: 7200, is_enabled: true, is_default: false },
    { price: 6800, is_enabled: true, is_default: true },
    { price: 100, is_enabled: false, is_default: true },
  ],
};

function flightChunk(content: string): string {
  return `<script>self.__next_f.push(${JSON.stringify([1, content])})</script>`;
}

function storefront(products: unknown, suffix = ""): string {
  return [
    flightChunk('{"unrelated":"chunk"}'),
    flightChunk(`{"products":${JSON.stringify(products)}${suffix}`),
  ].join("");
}

describe("public storefront parsing", () => {
  test("balances brackets and escaped quotes inside strings", () => {
    const source = '["front [mockup]", "escaped \\\" quote ]"]';
    expect(extractJsonArray(source, 0)).toBe(source);
  });

  test("ignores unrelated malformed flight chunks", () => {
    const html = "<script>self.__next_f.push(not-json)</script>" + storefront([publicProduct]);

    const result = extractPublicProducts(html);
    expect(result).toEqual({ _tag: "Success", products: [publicProduct] });
  });

  test("scans a valid candidate after an invalid candidate", () => {
    const invalid = flightChunk('{"products":[{"id":"changed-shape"}]}');
    const valid = storefront([publicProduct]);

    expect(extractPublicProducts(invalid + valid)).toEqual({
      _tag: "Success",
      products: [publicProduct],
    });
  });

  test("distinguishes a valid empty catalog from extraction failure", () => {
    expect(extractPublicProducts(storefront([]))).toEqual({
      _tag: "Success",
      products: [],
    });
    expect(extractPublicProducts(flightChunk('{"products":[not-json]}'))).toEqual({
      _tag: "Failure",
      reason: "invalid-products-candidate",
    });
  });
});

describe("product normalization", () => {
  test("cleans descriptions and keeps public links and prices", () => {
    expect(plainText(" <b>Heavy</b>&nbsp; cotton ")).toBe("Heavy cotton");
    expect(normalizePublicProduct(publicProduct, config)).toEqual({
      id: "api-1",
      title: "Public shirt",
      description: "Heavy cotton",
      price: 6400,
      currency: "EUR",
      href: "https://utxowear.printify.me/products/public-shirt",
      mockups: ["https://cdn.example/public.png"],
    });
  });

  test("filters invisible API products, selects default pricing, and orders mockups", () => {
    const result = normalizeApiProducts(
      [apiProduct, { ...apiProduct, id: "hidden", visible: false }],
      [publicProduct],
      config,
    );

    expect(result).toEqual([
      {
        id: "api-1",
        title: "API shirt",
        description: "Heavy cotton",
        price: 6800,
        currency: "EUR",
        href: "https://utxowear.printify.me/products/public-shirt",
        mockups: ["default.png", "front.png", "back.png"],
      },
    ]);
  });

  test("uses the configured shop exactly, then hostname matching and first shop", () => {
    const shops = [
      { id: 11, title: "Other" },
      { id: 12, title: " UTXOWEAR " },
    ];
    expect(chooseShop(shops, config)).toEqual(shops[1]);
    expect(
      chooseShop(shops, {
        ...config,
        shopId: "missing",
      }),
    ).toBeUndefined();
    expect(
      chooseShop(shops, {
        ...config,
        storeSlug: "unknown",
        shopId: undefined,
      }),
    ).toEqual(shops[0]);
  });
});
