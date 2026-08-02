import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { getAutoPoSuggestions } = await import("./autoPoSuggestService.js");

/**
 * Regression: ISSUE-002 — auto-PO suggestions leaked every tenant's catalogue.
 * Found by /qa on 2026-08-02
 * Report: .gstack/qa-reports/qa-report-localhost-2026-08-02.md
 *
 * `getAutoPoSuggestions` had no organisation filter. `stock_level` and
 * `location_ingredient` are LEFT JOINs, so another org's ingredient — with no
 * stock row at this location — scored current_qty = 0 and passed the below-par
 * test on its own org-level par. Standing in Almost French Pâtisserie (org 2)
 * the buyer saw Comfort Spoon Co. (org 1) items, their unit costs and preferred
 * suppliers, with the estimated spend total inflated by more than half.
 *
 * Deliberately a real-DB test: the bug was a missing SQL predicate, which a
 * mocked query cannot express, and both orgs must genuinely exist for the
 * assertion to mean anything.
 */

const ORG_ID = 2; // Almost French Pâtisserie
const OTHER_ORG_ID = 1; // Comfort Spoon Co.
const LOCATION_ID = "60b2ae1c-4a83-4108-a37f-e702b916751c"; // Almost French Patisserie

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(dbAvailable)("getAutoPoSuggestions — tenant isolation (real DB)", () => {
  it("returns ONLY ingredients belonging to the requested organisation", async () => {
    const result = await getAutoPoSuggestions(LOCATION_ID, ORG_ID);
    const names = result.suppliers.flatMap((s) => s.lines.map((l) => l.ingredientName));
    expect(names.length).toBeGreaterThan(0); // guard: a vacuous pass proves nothing

    // Every name returned must exist in THIS org. A name that exists only in
    // another org is the leak.
    // Parameterised IN list — a JS array does not bind to ANY() on this driver.
    const nameList = sql.join(names.map((n) => sql`${n}`), sql`, `);
    const foreign = (await db.execute<{ ingredient_name: string }>(sql`
      SELECT DISTINCT i.ingredient_name
        FROM ingredient i
       WHERE i.organisation_id <> ${ORG_ID}
         AND i.ingredient_name IN (${nameList})
         AND NOT EXISTS (
           SELECT 1 FROM ingredient mine
            WHERE mine.organisation_id = ${ORG_ID}
              AND mine.ingredient_name = i.ingredient_name
         )
    `)) as unknown as Array<{ ingredient_name: string }>;

    expect(
      foreign.map((r) => r.ingredient_name),
      "suggestions contain ingredients from another organisation",
    ).toEqual([]);
  }, 60_000);

  // Asserted by supplier_id, NOT name: both organisations legitimately have a
  // supplier called "PFD Food Services" as separate rows, so a name match is a
  // false positive. Only the id proves which tenant a block belongs to.
  it("does not surface another organisation's suppliers", async () => {
    const result = await getAutoPoSuggestions(LOCATION_ID, ORG_ID);
    const supplierIds = result.suppliers
      .map((s) => s.supplierId)
      .filter((id): id is string => !!id);

    if (supplierIds.length === 0) return; // nothing to assert against

    const idList = sql.join(supplierIds.map((id) => sql`${id}::uuid`), sql`, `);
    const foreign = (await db.execute<{ supplier_name: string; organisation_id: number }>(sql`
      SELECT supplier_name, organisation_id FROM supplier
       WHERE supplier_id IN (${idList})
         AND organisation_id <> ${ORG_ID}
    `)) as unknown as Array<{ supplier_name: string; organisation_id: number }>;

    expect(
      foreign.map((r) => `${r.supplier_name} (org ${r.organisation_id})`),
      "suggestions grouped under another organisation's supplier",
    ).toEqual([]);
  }, 60_000);

  it("scopes the estimated spend total to this organisation only", async () => {
    const mine = await getAutoPoSuggestions(LOCATION_ID, ORG_ID);
    const theirs = await getAutoPoSuggestions(LOCATION_ID, OTHER_ORG_ID);

    // Same location, different org → the two result sets must be DISJOINT by
    // ingredient id. Before the fix both calls returned the union of every
    // tenant, so the sets were identical and this overlap was total.
    expect(mine.totalLines).toBeGreaterThan(0);
    expect(theirs.totalLines).toBeGreaterThan(0);

    const mineIds = new Set(
      mine.suppliers.flatMap((s) => s.lines.map((l) => l.ingredientId)),
    );
    const overlap = theirs.suppliers
      .flatMap((s) => s.lines.map((l) => l.ingredientId))
      .filter((id) => mineIds.has(id));

    expect(overlap, "the same ingredient was suggested to two organisations").toEqual([]);
  }, 60_000);
});
