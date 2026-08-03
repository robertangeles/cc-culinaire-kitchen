import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

/**
 * Regression: inter-location transfers dropped the cost of the stock they moved.
 * Found by /qa follow-up on 2026-08-03.
 *
 * `confirmReceived` created a FIFO batch at the destination copying the source
 * batch's arrival date — so FIFO age survived the move — but never its
 * unit_cost, and never recomputed the destination's weighted average. Stock
 * arrived worth nothing.
 *
 * That compounds: wacService sums COALESCE(unit_cost, 0), so a null-cost batch
 * values its quantity at zero and drags the average down. A real transfer of
 * 5 kg of flour pulled Epicure's WAC from 1.2700 to 1.0313.
 *
 * Asserted against live data rather than a mock: the defect was a missing
 * column on an INSERT plus a missing service call, neither of which a mocked
 * query proves anything about.
 */

const ORG_ID = 2;

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(dbAvailable)("transfers carry cost across locations (real DB)", () => {
  it("never leaves a FIFO batch without a unit cost", async () => {
    const orphans = (await db.execute<{ ingredient_name: string; location_name: string }>(sql`
      SELECT i.ingredient_name, l.location_name
        FROM fifo_batch b
        JOIN ingredient i ON i.ingredient_id = b.ingredient_id AND i.organisation_id = ${ORG_ID}
        JOIN store_location l ON l.store_location_id = b.store_location_id
       WHERE b.unit_cost IS NULL
    `)) as unknown as Array<{ ingredient_name: string; location_name: string }>;

    expect(
      orphans.map((r) => `${r.ingredient_name} @ ${r.location_name}`),
      "a cost layer with no cost values that stock at zero in every WAC calculation",
    ).toEqual([]);
  }, 60_000);

  it("every transfer-created batch carries a cost", async () => {
    const rows = (await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fifo_batch b
        JOIN ingredient i ON i.ingredient_id = b.ingredient_id AND i.organisation_id = ${ORG_ID}
       WHERE b.source_transfer_id IS NOT NULL
         AND b.unit_cost IS NULL
    `)) as unknown as Array<{ n: number }>;

    expect(rows[0]?.n ?? 0, "transfer created stock with no cost behind it").toBe(0);
  }, 60_000);

  it("stock on hand is fully covered by cost layers", async () => {
    // The invariant the backfill restored. Batches falling SHORT of stock means
    // quantity arrived without a receipt; it is the direction that leaves value
    // unaccounted for.
    const uncovered = (await db.execute<{ ingredient_name: string; stock: string; covered: string }>(sql`
      SELECT i.ingredient_name, sl.current_qty AS stock, COALESCE(fb.covered, 0) AS covered
        FROM stock_level sl
        JOIN ingredient i ON i.ingredient_id = sl.ingredient_id AND i.organisation_id = ${ORG_ID}
        LEFT JOIN (
          SELECT ingredient_id, store_location_id, SUM(quantity_remaining::numeric) AS covered
            FROM fifo_batch WHERE is_depleted = FALSE GROUP BY 1, 2
        ) fb ON fb.ingredient_id = sl.ingredient_id AND fb.store_location_id = sl.store_location_id
       WHERE sl.current_qty::numeric > COALESCE(fb.covered, 0)
    `)) as unknown as Array<{ ingredient_name: string; stock: string; covered: string }>;

    expect(
      uncovered.map((r) => `${r.ingredient_name}: ${r.stock} on hand vs ${r.covered} costed`),
      "stock with no cost layer leaves weighted average cost understated",
    ).toEqual([]);
  }, 60_000);
});
