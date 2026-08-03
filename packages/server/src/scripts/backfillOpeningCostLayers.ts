/**
 * @module scripts/backfillOpeningCostLayers
 *
 * Gives seeded opening stock a FIFO cost layer, so weighted average cost is a
 * real number instead of null.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Opening stock was written straight into `stock_level` (by the catalog seed
 * and by stock takes), which moves quantity but never creates a `fifo_batch`.
 * Only stock that arrives through a delivery gets a cost layer. The result:
 * 219 of 222 stocked rows at Almost French had quantity on hand and no cost
 * behind it, so `location_ingredient.weighted_average_cost` stayed null and the
 * `fifo-batches-cover-stock-on-hand` integrity check warned.
 *
 * ── What it writes ─────────────────────────────────────────────────────────
 * ONE opening batch per (location, ingredient) that has stock and no batch:
 *   original_quantity = quantity_remaining = current stock on hand
 *   unit_cost         = COALESCE(location override, preferred, org default)
 *   source_po_line_id = NULL, source_transfer_id = NULL
 *
 * Then recomputes WAC through `wacService.recompute` — the owning code path —
 * rather than writing the column directly.
 *
 * ── Why the numbers do not move ────────────────────────────────────────────
 * WAC over a single batch is (Q × U) / Q = U, so each row's WAC lands on
 * exactly the unit cost that costing already falls back to today. Verified
 * before writing: this org has 0 per-location cost overrides and
 * preferred_unit_cost equals unit_cost on every row, so all three sources in
 * that COALESCE agree and there is no ambiguity about which one is "the" cost.
 *
 * Rows that ALREADY have batches are skipped on purpose. Plain Flour at
 * Patisserie has real receipts and a correct WAC of 1.4255; folding opening
 * stock into it would move a number that is right today.
 *
 * ── Reversal ───────────────────────────────────────────────────────────────
 * Opening batches are the only rows with BOTH source ids null (verified: 0 of
 * 11 existing batches match), so `--revert` deletes exactly what this wrote and
 * recomputes WAC again. Nothing else is identified by that shape.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillOpeningCostLayers.ts
 *     → dry run. Prints what it would write. Writes nothing.
 *   ... backfillOpeningCostLayers.ts --apply     → writes
 *   ... backfillOpeningCostLayers.ts --revert    → deletes opening batches, recomputes
 *   ... --org 2                                  → target org (default 2)
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const wacService = await import("../services/wacService.js");

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const orgArg = process.argv.indexOf("--org");
const ORG_ID = orgArg > -1 ? Number(process.argv[orgArg + 1]) : 2;
/**
 * Actor recorded on the WAC audit row.
 *
 * NOT a sentinel: `audit_log.actor_user_id` carries a foreign key to `user`, so
 * 0 or -1 fails the constraint and takes the whole recompute down with it.
 * Defaults to the organisation's lowest-numbered admin; override with
 * `--actor <userId>`.
 */
const actorArg = process.argv.indexOf("--actor");
let ACTOR_USER_ID = actorArg > -1 ? Number(process.argv[actorArg + 1]) : 0;

interface Target extends Record<string, unknown> {
  store_location_id: string;
  ingredient_id: string;
  ingredient_name: string;
  location_name: string;
  qty: string;
  unit_cost: string | null;
}

if (!Number.isFinite(ACTOR_USER_ID) || ACTOR_USER_ID <= 0) {
  const [admin] = (await db.execute<{ user_id: number }>(sql`
    SELECT uo.user_id FROM user_organisation uo
     WHERE uo.organisation_id = ${ORG_ID}
     ORDER BY uo.user_id
     LIMIT 1
  `)) as unknown as Array<{ user_id: number }>;
  if (!admin) {
    console.error(`No user belongs to organisation ${ORG_ID} — cannot attribute the audit row.`);
    process.exit(1);
  }
  ACTOR_USER_ID = admin.user_id;
}

if (REVERT) {
  const doomed = (await db.execute<{ store_location_id: string; ingredient_id: string }>(sql`
    SELECT store_location_id, ingredient_id FROM fifo_batch b
     WHERE b.source_po_line_id IS NULL
       AND b.source_transfer_id IS NULL
       AND EXISTS (
         SELECT 1 FROM ingredient i
          WHERE i.ingredient_id = b.ingredient_id AND i.organisation_id = ${ORG_ID}
       )
  `)) as unknown as Array<{ store_location_id: string; ingredient_id: string }>;

  console.log(`\nREVERT — ${doomed.length} opening batch(es) in org ${ORG_ID}`);
  if (!APPLY) {
    console.log("Dry run. Add --apply to actually delete.\n");
    process.exit(0);
  }
  await db.execute(sql`
    DELETE FROM fifo_batch b
     WHERE b.source_po_line_id IS NULL
       AND b.source_transfer_id IS NULL
       AND EXISTS (
         SELECT 1 FROM ingredient i
          WHERE i.ingredient_id = b.ingredient_id AND i.organisation_id = ${ORG_ID}
       )
  `);
  if (doomed.length > 0) {
    await wacService.recompute({
      pairs: doomed.map((d) => ({
        storeLocationId: d.store_location_id,
        ingredientId: d.ingredient_id,
      })),
      actorUserId: ACTOR_USER_ID,
      organisationId: ORG_ID,
      trigger: "manual",
    });
  }
  console.log(`Deleted ${doomed.length} and recomputed WAC.\n`);
  process.exit(0);
}

// Stock that is NOT covered by a cost layer.
//
// Keyed on the SHORTFALL, not on "has no batch at all". A row can be partly
// covered: Plain Flour at Patisserie holds 286.8 kg against 275 kg of received
// batches, so 11.8 kg of opening stock still has no cost behind it. Excluding
// any row that had a batch left the invariant violated on exactly those rows.
//
// Note the direction: this only ever fires when batches fall SHORT of stock,
// which means stock arrived without a receipt. Batches exceeding stock is the
// opposite problem (consumption reduces stock_level but never depletes a batch)
// and is deliberately not touched here.
const targets = (await db.execute<Target>(sql`
  SELECT sl.store_location_id,
         sl.ingredient_id,
         i.ingredient_name,
         l.location_name,
         (sl.current_qty::numeric - COALESCE(fb.covered, 0)) AS qty,
         COALESCE(li.unit_cost, i.preferred_unit_cost, i.unit_cost) AS unit_cost
    FROM stock_level sl
    JOIN ingredient i ON i.ingredient_id = sl.ingredient_id AND i.organisation_id = ${ORG_ID}
    JOIN store_location l ON l.store_location_id = sl.store_location_id
    LEFT JOIN location_ingredient li
      ON li.ingredient_id = sl.ingredient_id AND li.store_location_id = sl.store_location_id
    LEFT JOIN (
      SELECT ingredient_id, store_location_id, SUM(quantity_remaining::numeric) AS covered
        FROM fifo_batch WHERE is_depleted = FALSE GROUP BY 1, 2
    ) fb ON fb.ingredient_id = sl.ingredient_id AND fb.store_location_id = sl.store_location_id
   WHERE sl.current_qty::numeric > COALESCE(fb.covered, 0)
   ORDER BY l.location_name, i.ingredient_name
`)) as unknown as Target[];

// Batches carrying NO unit cost are the same hole from the other direction:
// wacService sums COALESCE(unit_cost, 0), so a null-cost batch silently values
// that stock at zero and drags the weighted average down. Transfers used to
// create exactly these (the cost was not carried across locations — fixed in
// transferService), and any left behind still poison the average.
const nullCostBatches = (await db.execute<{ batch_id: string; ingredient_id: string; store_location_id: string; fallback: string | null }>(sql`
  SELECT b.batch_id, b.ingredient_id, b.store_location_id,
         COALESCE(li.unit_cost, i.preferred_unit_cost, i.unit_cost) AS fallback
    FROM fifo_batch b
    JOIN ingredient i ON i.ingredient_id = b.ingredient_id AND i.organisation_id = ${ORG_ID}
    LEFT JOIN location_ingredient li
      ON li.ingredient_id = b.ingredient_id AND li.store_location_id = b.store_location_id
   WHERE b.unit_cost IS NULL
`)) as unknown as Array<{ batch_id: string; ingredient_id: string; store_location_id: string; fallback: string | null }>;

const priced = targets.filter((t) => t.unit_cost != null && Number(t.unit_cost) > 0);
const unpriced = targets.filter((t) => t.unit_cost == null || Number(t.unit_cost) <= 0);

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — opening cost layers, org ${ORG_ID}\n`);
console.log(`  rows with uncovered stock       : ${targets.length}`);
console.log(`  will get an opening batch        : ${priced.length}`);
console.log(`  skipped, no usable unit cost     : ${unpriced.length}`);
for (const u of unpriced.slice(0, 10)) {
  console.log(`      ! ${u.ingredient_name} @ ${u.location_name}`);
}

const value = priced.reduce((sum, t) => sum + Number(t.qty) * Number(t.unit_cost), 0);
console.log(`  opening inventory value          : $${value.toFixed(2)}`);
console.log(`  null-cost batches to price       : ${nullCostBatches.length}`);
console.log("\n  sample:");
for (const t of priced.slice(0, 6)) {
  console.log(
    `    ${t.ingredient_name.padEnd(26)} ${String(t.qty).padStart(9)} @ $${Number(t.unit_cost).toFixed(4)}  ${t.location_name}`,
  );
}

if (!APPLY) {
  console.log("\nNo writes. Re-run with --apply.\n");
  process.exit(0);
}

for (const t of priced) {
  await db.execute(sql`
    INSERT INTO fifo_batch
      (store_location_id, ingredient_id, arrival_date, quantity_remaining,
       original_quantity, unit_cost, source_po_line_id, source_transfer_id)
    VALUES
      (${t.store_location_id}::uuid, ${t.ingredient_id}::uuid, now(), ${t.qty}::numeric,
       ${t.qty}::numeric, ${t.unit_cost}::numeric, NULL, NULL)
  `);
}

for (const b of nullCostBatches) {
  if (b.fallback == null) continue;
  await db.execute(sql`
    UPDATE fifo_batch SET unit_cost = ${b.fallback}::numeric, updated_dttm = now()
     WHERE batch_id = ${b.batch_id}::uuid
  `);
}

// Recompute through the owning service so the audit row and locking behave
// exactly as they do for a real receipt.
await wacService.recompute({
  pairs: [
    ...priced.map((t) => ({
      storeLocationId: t.store_location_id,
      ingredientId: t.ingredient_id,
    })),
    ...nullCostBatches.map((b) => ({
      storeLocationId: b.store_location_id,
      ingredientId: b.ingredient_id,
    })),
  ],
  actorUserId: ACTOR_USER_ID,
  organisationId: ORG_ID,
  trigger: "manual",
});

console.log(`\nWrote ${priced.length} opening batches and recomputed WAC.\n`);
process.exit(0);
