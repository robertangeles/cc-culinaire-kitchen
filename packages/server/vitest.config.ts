import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // The integration suites share one local Postgres with no per-test isolation
    // (they scope by seeded ids). Run test FILES sequentially so an admin-scoped
    // global mutation (e.g. reembedFailedMemories resets all 'failed' rows) can't
    // clobber another file's asserted DB state mid-run. Tests within a file
    // already run in order; this only stops cross-file parallelism.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/db/**"],
    },
  },
});
