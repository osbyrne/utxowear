import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so that tests do not load the Cloudflare and TanStack Start plugins.
// Playwright specifications under tests/ are executed by `bun run test:e2e`, not by Vitest.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
