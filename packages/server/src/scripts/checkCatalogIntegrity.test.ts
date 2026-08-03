import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { runIntegrityChecks } = await import("./checkCatalogIntegrity.js");

/**
 * Real-DB integrity test.
 *
 * Deliberately NOT mocked. The whole reason these checks exist is that 660
 * mocked tests stayed green while the live system was in states it should
 * never be able to reach (see the module docblock). Mocking here would
 * reproduce the exact blind spot this is meant to close.
 *
 * The assertion is narrow on purpose: zero `error`-severity violations. `warn`
 * results are surfaced in the failure message but never fail the run, so a
 * known-degraded-but-legitimate state (seeded opening stock with no FIFO cost
 * layer) does not train anyone to ignore a red test.
 *
 * Gated on a reachable database, matching every other real-DB test here. Two
 * reasons, not one:
 *   1. CI's unit job has no DATABASE_URL, so an ungated run fails the pipeline
 *      on infrastructure rather than on a genuine integrity violation.
 *   2. CI's integration job would be worse than skipping — its Postgres is an
 *      empty throwaway, so org 2 has no catalog and every check would pass
 *      vacuously while proving nothing.
 * The value of these assertions is against seeded UAT data, which lives on the
 * dev DB. That is where this runs.
 */

const ORG_ID = 2; // Almost French Pâtisserie — the UAT org

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(dbAvailable)("catalog integrity (real DB)", () => {
  it("has no error-severity violations", async () => {
    const results = await runIntegrityChecks(ORG_ID);

    // Guard against the checks silently disappearing — a suite that asserts
    // "zero failures" over zero checks passes vacuously forever.
    expect(results.length).toBeGreaterThanOrEqual(8);

    const errors = results.filter((r) => !r.passed && r.severity === "error");

    // Build a message that explains itself: what broke, what it guaranteed,
    // and which past incident it was put there to prevent.
    const detail = errors
      .map(
        (r) =>
          `\n  ✗ ${r.name} — ${r.count} row(s)` +
          `\n      invariant: ${r.invariant}` +
          `\n      prevents:  ${r.prevents}` +
          r.sample.map((s) => `\n      · ${s}`).join(""),
      )
      .join("");

    expect(errors, `Catalog integrity violated:${detail}\n`).toHaveLength(0);
  }, 60_000); // remote dev DB — 8 aggregate queries over a slow link

  it("reports every check with a stated invariant and prevented incident", async () => {
    const results = await runIntegrityChecks(ORG_ID);
    for (const r of results) {
      expect(r.invariant.length, `${r.name} has no invariant`).toBeGreaterThan(10);
      expect(r.prevents.length, `${r.name} does not say what it prevents`).toBeGreaterThan(10);
      expect(["error", "warn"]).toContain(r.severity);
    }
  }, 60_000);
});
