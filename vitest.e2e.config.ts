import { defineConfig } from "vitest/config";

/**
 * End-to-end tests, kept out of `pnpm test`.
 *
 * They need a built web bundle and a real browser, so they are slower and have
 * an external prerequisite. `pnpm test` stays fast and hermetic; `pnpm test:e2e`
 * runs these and skips cleanly when the browser or the bundle is absent.
 */
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser, one server, shared across the file.
    fileParallelism: false,
  },
});
