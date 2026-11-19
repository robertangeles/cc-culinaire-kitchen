import { defineConfig } from "vitest/config";

// Pure-logic tests only (outbox, replay rules, lint rule). Screens are covered by device runs, not here.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
