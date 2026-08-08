import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(__dirname, "../../.env") });
// Test-only credentials live in packages/client/.env.test (gitignored) and take
// precedence over the app .env. `override: true` matters: dotenv keeps the
// first value it sees, so without it the root .env would win and any key set in
// both files would silently use the app value.
loadEnv({ path: path.resolve(__dirname, ".env.test"), override: true });

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./tests/e2e/_artifacts",
  fullyParallel: false,
  // Each test signs in through the API (login + MFA + page load) against a
  // remote dev database, so 30s is tight enough to fail on latency rather than
  // on a real defect.
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5179",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    // Signs in once and caches the session. The E2E account uses MFA, and a
    // TOTP is single-use per 30-second window, so a per-test login is
    // guaranteed to hit replay rejections when tests run back to back.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "./tests/e2e/_auth/storageState.json",
      },
      dependencies: ["setup"],
    },
  ],
});
