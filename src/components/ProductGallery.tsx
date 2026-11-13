import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";

export default function ProductGallery({
  title,
  images,
  productId,
  showThumbnails,
  drawable = false,
}: {
  title: string;
  images: string[];
  productId?: string;
  showThumbnails: boolean;
  drawable?: boolean;
}) {
  const mainImageId = useId();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedImage = images[selectedIndex] ?? images[0];
  const mainImage = selectedImage ? (
    <img
      {...stylex.props(styles.galleryImage)}
      src={selectedImage}
      alt={`${title} — mockup ${images.indexOf(selectedImage) + 1} of ${images.length}`}
      // CORS mode lets an HTML-in-canvas effect draw remote mockups. Native lazy loading
      // has no look-ahead margin inside an internal scroller, so load these immediately.
      crossOrigin={drawable ? "anonymous" : undefined}
      loading={drawable ? "eager" : "lazy"}
      decoding="async"
    />
  ) : null;

  return (
    <div {...stylex.props(styles.gallery)} role="group" aria-label={`${title} mockups`}>
      <div id={mainImageId} {...stylex.props(styles.galleryMain)}>
        {productId ? (
          <Link
            to="/products/$id"
            params={{ id: productId }}
            {...stylex.props(styles.galleryImageLink)}
          >
            {mainImage}
          </Link>
        ) : (
          mainImage
        )}
      </div>
      {showThumbnails && images.length > 0 && (
        <div {...stylex.props(styles.galleryThumbnails)} role="group" aria-label="Product mockups">
          {images.map((source, index) => (
            <button
              key={source}
              type="button"
              {...stylex.props(
                styles.galleryThumbnail,
                source === selectedImage && styles.galleryThumbnailSelected,
              )}
              aria-label={`View ${title} mockup ${index + 1}`}
              aria-pressed={source === selectedImage}
              aria-controls={mainImageId}
              onClick={() => setSelectedIndex(index)}
            >
              <img
                {...stylex.props(styles.galleryImage)}
                src={source}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
