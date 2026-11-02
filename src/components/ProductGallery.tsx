import { useId, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";

export default function ProductGallery({
  title,
  images,
  href,
}: {
  title: string;
  images: string[];
  href?: string;
}) {
  const trackId = useId();
  const track = useRef<HTMLDivElement>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const hasMultipleImages = images.length > 1;

  function selectImage(index: number) {
    const element = track.current;
    if (!element || !images.length) return;
    const nextIndex = (index + images.length) % images.length;
    element.scrollTo({ left: nextIndex * element.clientWidth, behavior: "instant" });
    setImageIndex(nextIndex);
  }

  return (
    <div role="group" aria-roledescription="carousel" aria-label={`${title} mockups`}>
      <div
        id={trackId}
        ref={track}
        {...stylex.props(styles.galleryTrack)}
        role="group"
        tabIndex={hasMultipleImages ? 0 : undefined}
        aria-label="Product images"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.clientWidth) {
            setImageIndex(Math.round(element.scrollLeft / element.clientWidth));
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          switch (event.key) {
            case "ArrowLeft":
              event.preventDefault();
              selectImage(imageIndex - 1);
              break;
            case "ArrowRight":
              event.preventDefault();
              selectImage(imageIndex + 1);
              break;
            case "Home":
              event.preventDefault();
              selectImage(0);
              break;
            case "End":
              event.preventDefault();
              selectImage(images.length - 1);
              break;
          }
        }}
      >
        {images.map((source, index) => {
          const image = (
            <img
              {...stylex.props(styles.galleryImage)}
              src={source}
              alt={`${title} — mockup ${index + 1} of ${images.length}`}
              loading="lazy"
              draggable={false}
            />
          );
          return (
            <div
              key={source}
              {...stylex.props(styles.gallerySlide)}
              aria-hidden={index !== imageIndex}
            >
              {href ? (
                <a
                  href={href}
                  {...stylex.props(styles.galleryImageLink)}
                  tabIndex={index === imageIndex ? 0 : -1}
                >
                  {image}
                </a>
              ) : (
                image
              )}
            </div>
          );
        })}
      </div>
      {hasMultipleImages && (
        <div {...stylex.props(styles.galleryControls)}>
          <button
            {...stylex.props(styles.button, styles.galleryButton)}
            type="button"
            aria-label="Previous mockup"
            aria-controls={trackId}
            onClick={() => selectImage(imageIndex - 1)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <input
            {...stylex.props(styles.gallerySlider)}
            type="range"
            min="1"
            max={images.length}
            value={imageIndex + 1}
            aria-label="Select mockup"
            aria-valuetext={`Mockup ${imageIndex + 1} of ${images.length}`}
            aria-controls={trackId}
            onChange={(event) => selectImage(Number(event.target.value) - 1)}
          />
          <span {...stylex.props(styles.galleryCount)} aria-live="polite" aria-atomic="true">
            {imageIndex + 1} / {images.length}
          </span>
          <button
            {...stylex.props(styles.button, styles.galleryButton)}
            type="button"
            aria-label="Next mockup"
            aria-controls={trackId}
            onClick={() => selectImage(imageIndex + 1)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
    </div>
  );
}
