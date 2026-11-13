import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

export default defineConfig({
  server: { port: 4321 },
  preview: { port: 4321 },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
    stylex.vite({
      useCSSLayers: true,
      enableMediaQueryOrder: true,
      devMode: "css-only",
      runtimeInjection: false,
      unstable_moduleResolution: { type: "commonJS" },
    }),
  ],
});
