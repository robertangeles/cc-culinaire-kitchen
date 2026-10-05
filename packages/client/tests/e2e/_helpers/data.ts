import type { APIRequestContext } from "@playwright/test";

/**
 * Test-data plumbing for self-seeding specs. Specs create what they need
 * through the real API under the run-scoped prefix (see safety.ts) and register
 * a cleanup for each row. Nothing here skips: a missing prerequisite throws.
 *
 * Every call asserts a 2xx and throws with status and body, so a seeding
 * failure is a loud setup failure rather than a vacuous pass.
 */

export type Defer = (label: string, undo: () => Promise<void>) => void;

/**
 * The server rate-limits every /api route except /api/auth to 300 requests a
 * minute per signed-in user (middleware/globalRateLimit.ts), and the browser,
 * seeding and cleanup all share the E2E user's budget. One page load costs ~15
 * requests, so a busy run can still exhaust it.
 * The server reports the budget in `RateLimit: "..."; r=<remaining>; t=<seconds to reset>`.
 */
function rateLimitState(res: { headers(): Record<string, string> }): { remaining: number; resetSeconds: number } | null {
  const m = /r=(\d+);\s*t=(\d+)/.exec(res.headers()["ratelimit"] ?? "");
  return m ? { remaining: Number(m[1]), resetSeconds: Number(m[2]) } : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Blocks until at least `needed` requests are left in the current rate-limit window. Costs one request per check. */
export async function waitForRateBudget(api: APIRequestContext, needed: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await api.get("/api/health");
    const state = rateLimitState(res);
    if (!state || (res.status() !== 429 && state.remaining >= needed)) return;
    await sleep((state.resetSeconds + 1) * 1000);
  }
  throw new Error(`rate-limit budget of ${needed} requests never became available`);
}

export async function apiCall<T = unknown>(
  api: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  data?: unknown,
): Promise<T> {
  let res = await api.fetch(url, { method, data });
  // A 429 is rejected before any handler runs, so retrying a write is safe.
  for (let attempt = 0; res.status() === 429 && attempt < 3; attempt++) {
    await sleep(((rateLimitState(res)?.resetSeconds ?? 60) + 1) * 1000);
    res = await api.fetch(url, { method, data });
  }
  if (!res.ok()) {
    throw new Error(`${method} ${url} -> ${res.status()}: ${(await res.text()).slice(0, 500)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Runs registered cleanups newest-first; keeps going after a failure and reports all of them at the end. */
export async function runCleanups(
  entries: ReadonlyArray<{ label: string; undo: () => Promise<void> }>,
): Promise<void> {
  const failures: string[] = [];
  for (const { label, undo } of [...entries].reverse()) {
    try {
      await undo();
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`E2E cleanup failed for ${failures.length} item(s):\n${failures.join("\n")}`);
  }
}
