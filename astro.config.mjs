// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [
      stylex.vite({
        useCSSLayers: true,
        devMode: "css-only",
        runtimeInjection: false,
        unstable_moduleResolution: { type: "commonJS" },
      }),
    ],
  },
});
