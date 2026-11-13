export function pageMetadata({
  origin,
  path,
  title = "utxowear",
  previewImage,
}: {
  origin: string;
  path: string;
  title?: string;
  previewImage?: { src: string; alt: string };
}) {
  const description = "Clothing inspired by cryptography whitepapers.";
  const image = new URL(previewImage?.src ?? "/images/link-preview.png", origin).href;
  const imageDescription = previewImage?.alt ?? "Black T-shirt in front of a cryptography paper.";
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "utxowear" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: new URL(path, origin).href },
      { property: "og:image", content: image },
      { property: "og:image:alt", content: imageDescription },
      ...(!previewImage
        ? [
            { property: "og:image:type", content: "image/png" },
            { property: "og:image:width", content: "1055" },
            { property: "og:image:height", content: "1055" },
          ]
        : []),
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: imageDescription },
    ],
  };
}
