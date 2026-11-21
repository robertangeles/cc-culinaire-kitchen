import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Drives a real Android phone or an emulator through adb, against a running server and Metro (see device/README in
// the dev brain page qa/mobile-device-walk). Credentials come from the environment or packages/client/.env.test.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../packages/client/.env.test") });

export default defineConfig({
  test: { environment: "node", include: ["device/**/*.device.test.ts"], testTimeout: 180_000, hookTimeout: 180_000, fileParallelism: false },
});
