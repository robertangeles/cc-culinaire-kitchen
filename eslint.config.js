import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/drizzle/**",
      "**/coverage/**",
      // Stale JS build artifacts in src/ dirs (TS-only project)
      "packages/*/src/**/*.js",
    ],
  },

  // Base: JS recommended + TS recommended for all packages
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Shared rule overrides (lenient for initial setup)
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-useless-assignment": "warn",
      "no-empty": "warn",
      "no-control-regex": "warn",
      "no-constant-binary-expression": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "warn",
    },
  },

  // Server: Node globals
  {
    files: ["packages/server/src/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Client: browser globals + React plugins
  {
    files: ["packages/client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Shared: no extra globals (pure TS)
  {
    files: ["packages/shared/src/**/*.ts"],
  }
);
