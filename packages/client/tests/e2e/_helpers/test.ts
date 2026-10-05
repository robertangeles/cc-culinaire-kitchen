import { test as base, expect, request, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCleanups, waitForRateBudget, type Defer } from "./data";
import { e2eBaseUrl } from "./safety";

const STORAGE_STATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../_auth/storageState.json");

/**
 * Every spec imports `test` from here, never from "@playwright/test" (enforced
 * by ESLint no-restricted-imports). The auto fixture fails a test that passes
 * its own assertions while the page threw an uncaught error or an /api/* call
 * returned 5xx in the background.
 *
 * Covers page traffic only. Helpers that use the request context (login,
 * seeding, cleanup) assert `response.ok()` themselves.
 * 401/403 are not failures: the logged-out and permission specs expect them.
 */

/** Empty by default. Each entry needs a comment naming the endpoint and why it is tolerated. */
const ALLOWED_5XX: ReadonlyArray<{ method: string; path: RegExp }> = [];

/** A page load costs ~15 /api requests and a test usually adds a few more. */
const RATE_BUDGET_PER_TEST = 30;

export const test = base.extend<{ failOnBackgroundErrors: void; rateBudget: void }, { api: APIRequestContext; defer: Defer }>({
  /** Authenticated API client (the cached E2E session) for seeding and cleanup. */
  api: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const api = await request.newContext({ baseURL: e2eBaseUrl(), storageState: STORAGE_STATE });
      await use(api);
      await api.dispose();
    },
    { scope: "worker" },
  ],
  /** Register an undo for a row you created; all run newest-first when the worker finishes. */
  defer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const entries: Array<{ label: string; undo: () => Promise<void> }> = [];
      await use((label, undo) => void entries.push({ label, undo }));
      await runCleanups(entries);
    },
    // Cleanup retries through rate-limit windows (see apiCall), which can take a minute or more.
    { scope: "worker", timeout: 180_000 },
  ],
  /** The server allows 60 /api requests a minute per IP; start each test with enough left that its own page loads are not answered 429. */
  rateBudget: [
    async ({ api }, use) => {
      await waitForRateBudget(api, RATE_BUDGET_PER_TEST);
      await use();
    },
    { auto: true, timeout: 90_000 },
  ],
  failOnBackgroundErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("response", (res) => {
        const { pathname } = new URL(res.url());
        const method = res.request().method();
        if (!pathname.startsWith("/api/") || res.status() < 500) return;
        if (ALLOWED_5XX.some((a) => a.method === method && a.path.test(pathname))) return;
        problems.push(`${res.status()} ${method} ${pathname}`);
      });
      await use();
      expect(problems, "uncaught page errors or /api 5xx during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
