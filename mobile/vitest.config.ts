import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Logic tests run in node. Screen tests (tests/*.test.tsx) opt into jsdom with a docblock and render the real
// screens through react-native-web; only native modules are faked (see vitest.setup.ts).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Shared schemas come from source, so a fresh checkout needs no `packages/shared` build to run the tests (Metro still reads dist/).
  resolve: { alias: { "react-native": "react-native-web", "@culinaire/shared/schemas": fileURLToPath(new URL("../packages/shared/src/schemas", import.meta.url)) } },
  test: {
    environment: "node",
    // src/config.ts throws without it; any screen that reaches it through appContext needs this default.
    env: { EXPO_PUBLIC_API_URL: "http://localhost:3009" },
    include: ["src/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: [/react-native-web/] } },
  },
});
