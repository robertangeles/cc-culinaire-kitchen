import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The phone's real client, session, count store and outbox against a running server (default :3009) and the
// seeded E2E user. Credentials come from the environment (CI) or packages/client/.env.test (gitignored).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../packages/client/.env.test") });

export default defineConfig({
  test: { environment: "node", include: ["e2e/**/*.e2e.test.ts"], testTimeout: 90_000, hookTimeout: 90_000, fileParallelism: false },
});
