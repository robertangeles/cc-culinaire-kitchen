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

export async function apiCall<T = unknown>(
  api: APIRequestContext,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  data?: unknown,
): Promise<T> {
  const res = await api.fetch(url, { method, data });
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
