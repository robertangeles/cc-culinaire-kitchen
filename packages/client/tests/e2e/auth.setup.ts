import { test as setup } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginAsTestUser } from "./_helpers/login";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where the authenticated session is cached for every spec to reuse. */
/**
 * Deliberately OUTSIDE `_artifacts/` — that is Playwright's `outputDir`, and
 * Playwright wipes it at the start of every run. Keeping the session there
 * meant it was deleted before it could ever be reused, so every run had to log
 * in again, and consecutive runs then collided on the single-use TOTP. Gitignored:
 * this file is a live session.
 */
export const STORAGE_STATE = path.resolve(__dirname, "_auth/storageState.json");

/**
 * Authenticate ONCE for the whole run and save the session.
 *
 * Every spec previously logged in per test, which is wrong here for a concrete
 * reason: the E2E account uses MFA, and a TOTP is single-use inside a
 * 30-second window. Sequential tests land in the same window, generate the same
 * code, and the server correctly rejects the replay — so a per-test login is
 * guaranteed to fail intermittently no matter how the helper is written.
 * Waiting out the window instead costs 31s per test and blows the timeout.
 *
 * Logging in once removes the whole class of problem, and takes the suite from
 * ~25s per test to ~25s total. This is also the fix for the KNOWN-FLAKY note on
 * the purchasing specs, whose per-test login raced the LocationContext fetch.
 */
setup("authenticate", async ({ page }) => {
  await loginAsTestUser(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
