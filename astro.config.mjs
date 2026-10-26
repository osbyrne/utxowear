// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [
    react(),
    {
      name: "command-specific-dependency-cache",
      hooks: {
        "astro:config:setup": ({ command, updateConfig }) => {
          // Builds must not replace dependency files used by a running dev server.
          updateConfig({ vite: { cacheDir: `./node_modules/.vite-${command}` } });
        },
      },
    },
  ],
  vite: {
    plugins: [
      stylex.vite({
        useCSSLayers: true,
        enableMediaQueryOrder: true,
        devMode: "css-only",
        runtimeInjection: false,
        unstable_moduleResolution: { type: "commonJS" },
      }),
    ],
  },
});
