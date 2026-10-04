import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalTarget, e2eBaseUrl, newRunId } from "./tests/e2e/_helpers/safety";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.resolve(__dirname, "../../.env") });
// Test-only credentials live in packages/client/.env.test (gitignored) and take
// precedence over the app .env. `override: true` matters: dotenv keeps the
// first value it sees, so without it the root .env would win and any key set in
// both files would silently use the app value.
loadEnv({ path: path.resolve(__dirname, ".env.test"), override: true });

// One run id for the whole run; workers inherit it through the environment.
process.env.E2E_RUN_ID ??= newRunId();

const baseURL = e2eBaseUrl();
assertLocalTarget(baseURL);

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./tests/e2e/_artifacts",
  fullyParallel: false,
  // Each test signs in through the API (login + MFA + page load) against a
  // remote dev database, so 30s is tight enough to fail on latency rather than
  // on a real defect.
  timeout: 60_000,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  // The JSON report feeds scripts/checkE2eSkips.mjs. It lives outside outputDir,
  // which Playwright wipes at the start of every run.
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "./tests/e2e/_reports/results.json" }],
  ],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL,
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
