import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { normalizeApiProduct, normalizePublicProduct, parseProductDescription } from "./parsing";
import { normalizePrintifyConfig, type PrintifyProduct } from "./model";

test("extracts a whitepaper from a text description without displaying the metadata", () => {
  expect(
    parseProductDescription(
      "Heavyweight cotton.\nWhitepaper: /whitepapers/bitcoin.pdf\nUnisex fit.",
    ),
  ).toEqual({
    description: "Heavyweight cotton.\nUnisex fit.",
    whitepaperUrl: "/whitepapers/bitcoin.pdf",
  });
});

test("extracts a direct PDF link from Printify rich text and decodes query separators", () => {
  expect(
    parseProductDescription(
      '<p>Heavyweight cotton.</p><p>Whitepaper: <a href="https://papers.example/bitcoin.pdf?version=1&amp;download=1">https://papers.example/bitcoin.pdf?version=1&amp;download=1</a></p><p>Unisex fit.</p>',
    ),
  ).toEqual({
    description: "Heavyweight cotton.\n\nUnisex fit.",
    whitepaperUrl: "https://papers.example/bitcoin.pdf?version=1&download=1",
  });
  expect(
    parseProductDescription("Heavyweight cotton.<br />whitepaper:&nbsp;/whitepapers/bitcoin.pdf"),
  ).toEqual({ description: "Heavyweight cotton.", whitepaperUrl: "/whitepapers/bitcoin.pdf" });
});

test("preserves ordinary descriptions and does not infer a whitepaper from unrelated PDF links", () => {
  expect(parseProductDescription("<p>Cotton&nbsp;shirt</p><p>Unisex fit.</p>")).toEqual({
    description: "Cotton shirt\n\nUnisex fit.",
    whitepaperUrl: undefined,
  });
  expect(
    parseProductDescription("Size chart: https://papers.example/sizes.pdf").whitepaperUrl,
  ).toBeUndefined();
  expect(parseProductDescription()).toEqual({ description: "", whitepaperUrl: undefined });
});

test("does not turn unsafe or unsupported metadata into download links", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:application/pdf;base64,JVBERi0=",
    "http://papers.example/bitcoin.pdf",
    "//papers.example/bitcoin.pdf",
    "https://account:password@papers.example/bitcoin.pdf",
    "https://papers.example/bitcoin.html",
    "/other/bitcoin.pdf",
    "/whitepapers/../private.pdf",
    "/whitepapers/%2e%2e/private.pdf",
  ]) {
    const description = `Whitepaper: ${url}`;
    expect(parseProductDescription(description)).toEqual({ description, whitepaperUrl: undefined });
  }
});

test("keeps the first valid whitepaper if metadata is repeated", () => {
  expect(
    parseProductDescription(
      "Whitepaper: /whitepapers/bitcoin.pdf\nWhitepaper: /whitepapers/other.pdf",
    ),
  ).toEqual({ description: "", whitepaperUrl: "/whitepapers/bitcoin.pdf" });
});

test("includes whitepaper metadata in both authenticated and public product catalogs", () => {
  const config = normalizePrintifyConfig({}).config;
  const description = "<p>Cotton shirt</p><p>Whitepaper: /whitepapers/bitcoin.pdf</p>";
  const product: PrintifyProduct = {
    id: "bitcoin-shirt",
    title: "Bitcoin",
    description,
    visible: true,
    images: [{ src: "https://example.com/shirt.png", position: "front", is_default: true }],
    variants: [{ id: 1, title: "M", price: 2000, is_enabled: true, is_default: true, options: [] }],
  };
  const metadata = { description: "Cotton shirt", whitepaperUrl: "/whitepapers/bitcoin.pdf" };
  expect(normalizeApiProduct(product, config)).toMatchObject(metadata);
  expect(
    normalizePublicProduct(
      { id: 1, title: "Bitcoin", description, image: "https://example.com/shirt.png" },
      config,
    ),
  ).toMatchObject(metadata);
});

test("preserves authored Markdown paragraphs, emphasis, and lists", () => {
  const description = "## Materials\n\n**Cotton** and *wool*.\n\n- Soft\n- Wash cold";
  expect(parseProductDescription(description)).toEqual({ description, whitepaperUrl: undefined });
});

test("converts Printify rich text to Markdown and preserves whitepaper metadata", () => {
  expect(
    parseProductDescription(
      '<h2>Materials</h2><p><strong>Cotton</strong> &amp; wool.</p><ul><li>Soft</li><li><em>Wash cold</em></li></ul><p><a href="https://example.com/care">Care guide</a></p><p>Whitepaper: /whitepapers/bitcoin.pdf</p>',
    ),
  ).toEqual({
    description:
      "## Materials\n\n**Cotton** & wool.\n\n* Soft\n* _Wash cold_\n\n[Care guide](https://example.com/care)",
    whitepaperUrl: "/whitepapers/bitcoin.pdf",
  });
});

test.each([
  ["Use `<span>` for labels.", "<p>Use <code>&lt;span&gt;</code> for labels.</p>"],
  [
    "```html\n<p>Label</p>\n```",
    '<pre><code class="language-html">&lt;p&gt;Label&lt;/p&gt;\n</code></pre>',
  ],
  ["<p>Size &lt;small&gt;, **literal**</p>", "<p>Size &lt;small&gt;, **literal**</p>"],
])(
  "renders literal code and rich-text characters without losing text: %s",
  (source, expectedMarkup) => {
    const { description } = parseProductDescription(source);
    expect(renderToStaticMarkup(createElement(Markdown, { skipHtml: true }, description))).toBe(
      expectedMarkup,
    );
  },
);

test("discards script and style contents during rich-text conversion", () => {
  expect(
    parseProductDescription(
      "<p>Cotton</p><script>alert(1)</script><style>body { display: none }</style>",
    ),
  ).toEqual({
    description: "Cotton",
    whitepaperUrl: undefined,
  });
});
