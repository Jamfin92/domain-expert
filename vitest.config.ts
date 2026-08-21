import { defineConfig } from "vitest/config";

// Hermetic by design: no network, no model hosts, no writes outside tmp.
// The live probe lives in `pnpm doctor`, never in the suite.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
