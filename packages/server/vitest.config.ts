import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // The integration suites share ONE Postgres with no per-test isolation
    // (they scope by seeded ids). Run test FILES sequentially so an admin-scoped
    // global mutation (e.g. reembedFailedMemories resets all 'failed' rows) can't
    // clobber another file's asserted DB state mid-run. Tests within a file
    // already run in order; this only stops cross-file parallelism.
    fileParallelism: false,

    // The dev database is a REMOTE Render instance, not the local Postgres this
    // config was originally written for. Every query in a real-DB test now pays
    // network round-trip latency (~200ms+ measured), so suites that finished
    // comfortably inside vitest's 5s default started timing out — reported as
    // "flaky brain tests" when nothing was flaky and nothing was broken.
    // 30s is sized for remote latency while still catching a genuine hang.
    // Mocked tests are unaffected: they finish in milliseconds either way.
    testTimeout: 30_000,
    // beforeAll/afterAll in the integration suites seed and tear down real rows
    // and hit the same wall (vitest default hookTimeout is 10s).
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/db/**"],
    },
  },
});
