import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Logic tests run in node. Screen tests (tests/*.test.tsx) opt into jsdom with a docblock and render the real
// screens through react-native-web; only native modules are faked (see vitest.setup.ts).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Shared schemas come from source, so a fresh checkout needs no `packages/shared` build to run the tests (Metro still reads dist/).
  resolve: {
    alias: [
      { find: "react-native", replacement: "react-native-web" },
      { find: "@culinaire/shared/schemas", replacement: fileURLToPath(new URL("../packages/shared/src/schemas", import.meta.url)) },
      // The package root (option lists, costing) from source too; exact match, so the schemas line above still wins for its paths.
      { find: /^@culinaire\/shared$/, replacement: fileURLToPath(new URL("../packages/shared/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    // src/config.ts throws without it; any screen that reaches it through appContext needs this default.
    env: { EXPO_PUBLIC_API_URL: "http://localhost:3009" },
    include: ["src/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // Screen tests find buttons by role, which is slow in jsdom: a keypad test that takes 2 s here took over 6 s on the CI runner.
    testTimeout: 30_000,
    server: { deps: { inline: [/react-native-web/] } },
  },
});
