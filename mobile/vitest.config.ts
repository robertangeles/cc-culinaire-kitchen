import { defineConfig } from "vitest/config";

// Logic tests run in node. Screen tests (tests/*.test.tsx) opt into jsdom with a docblock and render the real
// screens through react-native-web; only native modules are faked (see vitest.setup.ts).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "react-native": "react-native-web" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: [/react-native-web/] } },
  },
});
