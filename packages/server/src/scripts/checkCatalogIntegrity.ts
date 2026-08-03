/**
 * @module scripts/checkCatalogIntegrity
 *
 * Data-integrity checks that run against a REAL database.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-08-02 a single session surfaced five separate defects that 660
 * passing unit tests had not caught, because those tests mock the database and
 * therefore verify code SHAPE, not system STATE:
 *
 *   1. `confirmReceipt` 500'd on every receipt (a Date bound into raw SQL).
 *   2. A PO sat `SENT` while an ACTIVE receiving session existed, with no path
 *      out — the two disagreed and nothing noticed.
 *   3. Two ACTIVE receiving sessions existed for one PO (pre-lock race).
 *   4. `preferred_unit_cost` was NULL catalog-wide because its trigger's source
 *      column was never populated — so yield variance computed $0 cost and
 *      reported a 100% favourable variance for every dish.
 *   5. 108 of 110 stocked items had no FIFO cost layer, so WAC was null.
 *
 * Every one of those is invisible to a mocked test and obvious to a SELECT.
 * This module is the SELECT. Each check names the incident it prevents, so a
 * future failure is self-explaining rather than a puzzle.
 *
 * ── Contract ───────────────────────────────────────────────────────────────
 * `runIntegrityChecks(orgId)` returns one result per check. It NEVER throws on
 * a data problem — it reports. The CLI exits 1 if any `error` check fails, so
 * it is usable as a pre-deploy gate; the test asserts the same thing.
 *
 * Severity:
 *   error — a state the system should never be able to reach. Fix before ship.
 *   warn  — legitimate-but-degraded state worth seeing (e.g. seeded opening
 *           stock with no cost layer). Does not fail the run.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   pnpm --filter @culinaire/server exec tsx src/scripts/checkCatalogIntegrity.ts
 *   pnpm --filter @culinaire/server exec tsx src/scripts/checkCatalogIntegrity.ts --org 2
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

// Env bootstrap MUST complete before ../db is imported — the db module resolves
// its connection string at import time. Doing it here (rather than only in the
// CLI block) means a test can `import { runIntegrityChecks }` and get a working
// connection with no per-test setup.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();
const { db } = await import("../db/index.js");

export type Severity = "error" | "warn";

export interface CheckResult {
  name: string;
  severity: Severity;
  passed: boolean;
  count: number;
  /** What the check guarantees when it passes. */
  invariant: string;
  /** The incident this check exists to prevent. */
  prevents: string;
  /** Offending rows, capped — enough to start debugging without a wall of text. */
  sample: string[];
}

interface CheckSpec {
  name: string;
  severity: Severity;
  invariant: string;
  prevents: string;
  /** Returns offending rows. Empty array = pass. */
  run: (orgId: number) => Promise<Array<Record<string, unknown>>>;
}

const rowsOf = async (q: ReturnType<typeof sql>) =>
  (await db.execute<Record<string, unknown>>(q)) as unknown as Array<Record<string, unknown>>;

const CHECKS: CheckSpec[] = [
  {
    name: "po-status-matches-receiving-session",
    severity: "error",
    invariant:
      "A PO is RECEIVING if and only if it has an ACTIVE receiving session.",
    prevents:
      "PO stuck SENT with an orphaned ACTIVE session — 'A receiving session is already in progress' with no way in (2026-08-02).",
    run: (orgId) =>
      rowsOf(sql`
        SELECT po.po_number, po.status AS po_status,
               count(rs.session_id) FILTER (WHERE rs.status = 'ACTIVE') AS active_sessions
          FROM purchase_order po
          LEFT JOIN receiving_session rs ON rs.po_id = po.po_id
         WHERE po.organisation_id = ${orgId}
         GROUP BY po.po_number, po.status
        HAVING (po.status = 'RECEIVING') <> (count(rs.session_id) FILTER (WHERE rs.status = 'ACTIVE') > 0)
      `),
  },
  {
    name: "one-active-session-per-po",
    severity: "error",
    invariant: "A PO never has more than one ACTIVE receiving session.",
    prevents:
      "The pre-advisory-lock race that created two sessions for one PO and left it permanently stuck (2026-08-01).",
    run: (orgId) =>
      rowsOf(sql`
        SELECT po.po_number, count(*) AS active_sessions
          FROM receiving_session rs
          JOIN purchase_order po ON po.po_id = rs.po_id
         WHERE rs.status = 'ACTIVE' AND po.organisation_id = ${orgId}
         GROUP BY po.po_number
        HAVING count(*) > 1
      `),
  },
  {
    name: "every-ingredient-has-a-cost",
    severity: "error",
    invariant: "Every active ingredient has a usable cost per kitchen unit.",
    prevents:
      "Recipe and menu costing silently treating an ingredient as free.",
    run: (orgId) =>
      rowsOf(sql`
        SELECT ingredient_name
          FROM ingredient
         WHERE organisation_id = ${orgId} AND deleted_at IS NULL
           AND COALESCE(preferred_unit_cost, unit_cost) IS NULL
      `),
  },
  {
    name: "preferred-supplier-link-has-cost",
    severity: "error",
    invariant:
      "Every preferred ingredient_supplier link carries a cost_per_unit — the trigger's only input.",
    prevents:
      "preferred_unit_cost NULL catalog-wide, which made yield variance compute $0 actual cost and report a fictional 100% favourable variance (2026-08-02).",
    run: (orgId) =>
      rowsOf(sql`
        SELECT i.ingredient_name
          FROM ingredient_supplier isup
          JOIN ingredient i ON i.ingredient_id = isup.ingredient_id
         WHERE isup.preferred_ind = TRUE
           AND isup.cost_per_unit IS NULL
           AND i.organisation_id = ${orgId} AND i.deleted_at IS NULL
      `),
  },
  {
    name: "preferred-cost-matches-trigger-source",
    severity: "error",
    invariant:
      "ingredient.preferred_unit_cost equals the preferred supplier link's cost_per_unit.",
    prevents:
      "Silent drift from direct SQL surgery. The schema promised this reconciliation check in serverIndex; it was never actually written (found 2026-08-02).",
    run: (orgId) =>
      rowsOf(sql`
        SELECT i.ingredient_name,
               i.preferred_unit_cost AS cached,
               isup.cost_per_unit    AS source
          FROM ingredient i
          JOIN ingredient_supplier isup
            ON isup.ingredient_id = i.ingredient_id AND isup.preferred_ind = TRUE
         WHERE i.organisation_id = ${orgId} AND i.deleted_at IS NULL
           AND i.preferred_unit_cost IS DISTINCT FROM isup.cost_per_unit
      `),
  },
  {
    name: "received-po-lines-have-actual-cost",
    severity: "error",
    invariant:
      "Every received PO line records the price actually paid, not just the ordered price.",
    prevents:
      "Receipt history showing the ordered price and hiding a price change taken at the door (2026-08-02).",
    run: (orgId) =>
      rowsOf(sql`
        SELECT po.po_number, i.ingredient_name
          FROM purchase_order_line pol
          JOIN purchase_order po ON po.po_id = pol.po_id
          JOIN ingredient i ON i.ingredient_id = pol.ingredient_id
         WHERE po.organisation_id = ${orgId}
           AND pol.received_dttm IS NOT NULL
           AND pol.actual_unit_cost IS NULL
      `),
  },
  {
    name: "stock-never-negative",
    severity: "error",
    invariant: "No stock_level row is negative.",
    prevents:
      "deductStock writing past zero — it decrements without a floor, so an over-deduction is silent.",
    run: (orgId) =>
      rowsOf(sql`
        SELECT i.ingredient_name, sl.current_qty
          FROM stock_level sl
          JOIN ingredient i ON i.ingredient_id = sl.ingredient_id
         WHERE i.organisation_id = ${orgId} AND sl.current_qty::numeric < 0
      `),
  },
  {
    name: "fifo-batches-cover-stock-on-hand",
    severity: "warn",
    invariant:
      "Stock on hand is backed by FIFO cost layers, so WAC reflects real inventory.",
    prevents:
      "Seeded opening stock with no cost layer — 108 of 110 items had stock but no batch, leaving WAC null (2026-08-02). Expected to warn until an opening-cost backfill runs.",
    run: (orgId) =>
      rowsOf(sql`
        SELECT i.ingredient_name,
               sl.current_qty AS stock,
               COALESCE(fb.qty, 0) AS batch_qty
          FROM stock_level sl
          JOIN ingredient i ON i.ingredient_id = sl.ingredient_id
          LEFT JOIN (
            SELECT ingredient_id, store_location_id, SUM(quantity_remaining) AS qty
              FROM fifo_batch WHERE is_depleted = FALSE GROUP BY 1, 2
          ) fb ON fb.ingredient_id = sl.ingredient_id
              AND fb.store_location_id = sl.store_location_id
         WHERE i.organisation_id = ${orgId} AND i.deleted_at IS NULL
           AND sl.current_qty::numeric > 0
           AND COALESCE(fb.qty, 0)::numeric < sl.current_qty::numeric
      `),
  },
];

export async function runIntegrityChecks(orgId: number): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const spec of CHECKS) {
    const offenders = await spec.run(orgId);
    results.push({
      name: spec.name,
      severity: spec.severity,
      passed: offenders.length === 0,
      count: offenders.length,
      invariant: spec.invariant,
      prevents: spec.prevents,
      sample: offenders.slice(0, 5).map((r) => JSON.stringify(r)),
    });
  }
  return results;
}

// ── CLI ───────────────────────────────────────────────────────────────────

const isCli = process.argv[1]?.includes("checkCatalogIntegrity");
if (isCli) {
  const argIdx = process.argv.indexOf("--org");
  const orgId = argIdx > -1 ? Number(process.argv[argIdx + 1]) : 2;

  const results = await runIntegrityChecks(orgId);
  const failed = results.filter((r) => !r.passed);
  const hardFailures = failed.filter((r) => r.severity === "error");

  console.log(`\nCatalog integrity — org ${orgId}\n`);
  for (const r of results) {
    const mark = r.passed ? "PASS" : r.severity === "error" ? "FAIL" : "WARN";
    console.log(`  [${mark}] ${r.name}${r.passed ? "" : ` — ${r.count} row(s)`}`);
    if (!r.passed) {
      console.log(`         invariant: ${r.invariant}`);
      console.log(`         prevents:  ${r.prevents}`);
      for (const s of r.sample) console.log(`         · ${s}`);
      if (r.count > r.sample.length) console.log(`         · …${r.count - r.sample.length} more`);
    }
  }

  const warns = failed.filter((r) => r.severity === "warn").length;
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      `  ·  ${hardFailures.length} error  ·  ${warns} warn\n`,
  );
  process.exit(hardFailures.length > 0 ? 1 : 0);
}
