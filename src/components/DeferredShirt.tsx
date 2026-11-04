import { lazy, useRef } from "react";
import * as stylex from "@stylexjs/stylex";
import { styles } from "../styles/storefront.stylex";
import WhitepaperAbstract from "./WhitepaperAbstract";
import DeferredContent from "./DeferredContent";

const Shirt = lazy(() => import("./Shirt"));

export default function DeferredShirt() {
  const container = useRef<HTMLDivElement>(null);
  return (
    <div
      id="canvas-container"
      ref={container}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.hasPointerCapture(event.pointerId)) {
          event.preventDefault();
        }
      }}
      {...stylex.props(styles.shirtPreviewContainer)}
    >
      <WhitepaperAbstract />
      <DeferredContent
        loadingFallback={
          <p {...stylex.props(styles.previewStatus)} role="status">
            Loading 3D preview…
          </p>
        }
        errorFallback={
          <p {...stylex.props(styles.previewStatus)} role="alert">
            The 3D preview could not load. <a href="/3d-shirt">Reload</a>
          </p>
        }
      >
        <Shirt container={container} />
      </DeferredContent>
    </div>
  );
}
