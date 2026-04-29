/**
 * @module services/wacService
 *
 * Catalog-spine Phase 1: per-location Weighted Average Cost.
 *
 * WAC formula:
 *   weighted_average_cost(location, ingredient) =
 *     SUM(fifo_batch.original_quantity * fifo_batch.unit_cost)
 *   / SUM(fifo_batch.original_quantity)
 *   for batches at that (location, ingredient).
 *
 * When recompute runs:
 *   - Eagerly inside `receivingService.confirmReceipt`, after FIFO batches
 *     are created, before the transaction commits. SELECT FOR UPDATE on the
 *     affected `location_ingredient` rows in stable sort order serialises
 *     concurrent receivings on overlapping (location, ingredient) pairs.
 *   - Manually via admin tooling (future).
 *
 * Why eager + serialised: the alternatives (lazy / async queue / SERIALIZABLE
 * tx) either expose stale costs to the daily editor or force every cost read
 * to handle stale flags. Eager + row-locks keeps the read path simple.
 *
 * Notes on scope:
 *   - Phase 1 doesn't include "reverse on void" because the receiving state
 *     machine has no path to void a COMPLETED session. The hook
 *     `reverseOnVoid` is reserved for future admin tooling that adds one.
 *   - The `location_ingredient` row is created on the fly if one doesn't
 *     exist for (location, ingredient) yet — receiving an ingredient at a
 *     location it's never been seen at MUST not silently drop the WAC.
 */

import { sql, and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import * as auditService from "./auditService.js";
import { locationIngredient } from "../db/schema.js";

export interface WacRecomputeInput {
  /** Pairs to recompute. Caller must collect the set from the receiving event. */
  pairs: Array<{ storeLocationId: string; ingredientId: string }>;
  /** User who triggered the receiving event. Logged on the audit row. */
  actorUserId: number;
  organisationId: number;
  /** What kicked the recompute. Recorded in metadata for forensic reads. */
  trigger: "receiving" | "manual" | "void_reverse";
  /** Optional id of the originating event (receiving_session_id, etc). */
  triggerEntityId?: string | null;
}

/**
 * Recompute WAC for every (location, ingredient) pair in the input.
 *
 * Steps inside the transaction:
 *   1. Sort pairs by (locationId, ingredientId) so locks are acquired in a
 *      stable order — defeats the deadlock the bulk-UPDATE approach alone
 *      would expose.
 *   2. Ensure a `location_ingredient` row exists for each pair. Insert with
 *      defaults if missing.
 *   3. SELECT FOR UPDATE all affected rows.
 *   4. Bulk SQL UPDATE setting weighted_average_cost from a CTE that
 *      aggregates `fifo_batch` for each pair.
 *   5. Write a single `wac_recompute` audit row scoped to the trigger entity.
 *
 * Pass `tx` from the surrounding receiving transaction so all of this commits
 * atomically with the FIFO batch inserts that fed the recompute.
 */
export async function recompute(
  input: WacRecomputeInput,
  tx: DbOrTx = db,
): Promise<{ recomputed: number; updatedAt: Date }> {
  const { pairs, actorUserId, organisationId, trigger, triggerEntityId } = input;
  if (pairs.length === 0) {
    return { recomputed: 0, updatedAt: new Date() };
  }

  // Stable sort — same locations + ingredients across concurrent calls
  // acquire row locks in the same order, so two simultaneous receiving
  // events on overlapping pairs serialise instead of deadlocking.
  const sorted = [...pairs].sort((a, b) => {
    if (a.storeLocationId !== b.storeLocationId) {
      return a.storeLocationId < b.storeLocationId ? -1 : 1;
    }
    return a.ingredientId < b.ingredientId ? -1 : 1;
  });

  // Step 2: ensure rows exist. INSERT ... ON CONFLICT DO NOTHING is the
  // idiomatic Postgres pattern; the unique index on (ingredient, location)
  // makes it safe.
  const insertValues = sorted.map((p) => ({
    ingredientId: p.ingredientId,
    storeLocationId: p.storeLocationId,
    activeInd: true,
  }));
  await tx
    .insert(locationIngredient)
    .values(insertValues)
    .onConflictDoNothing({
      target: [locationIngredient.ingredientId, locationIngredient.storeLocationId],
    });

  // Step 3: SELECT FOR UPDATE. Postgres doesn't support multi-pair tuple
  // FOR UPDATE in Drizzle's typed builder cleanly, so we drop to raw SQL.
  // The lock is held until tx commits.
  const lockRows = await tx.execute<{ location_ingredient_id: string }>(sql`
    SELECT location_ingredient_id
      FROM location_ingredient
     WHERE (store_location_id, ingredient_id) IN (
       ${sql.join(
         sorted.map((p) => sql`(${p.storeLocationId}::uuid, ${p.ingredientId}::uuid)`),
         sql`, `,
       )}
     )
     ORDER BY store_location_id, ingredient_id
       FOR UPDATE
  `);

  // Step 4: bulk recompute via UPDATE FROM (subquery aggregating fifo_batch).
  // One statement, one round-trip, regardless of how many pairs.
  const now = new Date();
  await tx.execute(sql`
    UPDATE location_ingredient li
       SET weighted_average_cost = sub.wac,
           wac_last_recomputed_at = ${now},
           updated_dttm = ${now}
      FROM (
        SELECT b.store_location_id,
               b.ingredient_id,
               CASE
                 WHEN COALESCE(SUM(b.original_quantity::numeric), 0) = 0 THEN NULL
                 ELSE SUM(b.original_quantity::numeric * COALESCE(b.unit_cost, 0)::numeric)
                      / NULLIF(SUM(b.original_quantity::numeric), 0)
               END AS wac
          FROM fifo_batch b
         WHERE (b.store_location_id, b.ingredient_id) IN (
           ${sql.join(
             sorted.map((p) => sql`(${p.storeLocationId}::uuid, ${p.ingredientId}::uuid)`),
             sql`, `,
           )}
         )
         GROUP BY b.store_location_id, b.ingredient_id
      ) sub
     WHERE li.store_location_id = sub.store_location_id
       AND li.ingredient_id = sub.ingredient_id
  `);

  // Step 5: audit. One row covers the whole bulk recompute. Per-pair detail
  // would explode the audit log without adding forensic value.
  await auditService.log(
    {
      entityType: "location_ingredient",
      entityId: triggerEntityId ?? "bulk",
      action: "wac_recompute",
      actorUserId,
      organisationId,
      metadata: {
        trigger,
        pairsRecomputed: sorted.length,
        triggerEntityId,
      },
    },
    tx,
  );

  return { recomputed: sorted.length, updatedAt: now };
}

/**
 * Future hook for when admin tooling adds a "void confirmed receipt" path.
 * Today the receiving state machine prevents this — confirmed sessions are
 * terminal. When the admin path lands, this function will rerun the same
 * computation excluding fifo_batch rows from the voided receipt.
 *
 * Throws today so a stray caller doesn't silently no-op.
 */
export async function reverseOnVoid(_voidedReceivingSessionId: string): Promise<never> {
  throw new Error(
    "wacService.reverseOnVoid is not yet implemented — confirmed receipts are terminal in Phase 1. " +
      "Add the admin void path before wiring this up.",
  );
}

/**
 * Read the cached WAC for a (location, ingredient) pair. Returns null if no
 * receiving has happened yet. The Menu Intelligence P&L view consumes this.
 */
export async function getWac(
  storeLocationId: string,
  ingredientId: string,
): Promise<{ wac: string | null; recomputedAt: Date | null }> {
  const [row] = await db
    .select({
      wac: locationIngredient.weightedAverageCost,
      recomputedAt: locationIngredient.wacLastRecomputedAt,
    })
    .from(locationIngredient)
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        eq(locationIngredient.ingredientId, ingredientId),
      ),
    );
  return {
    wac: row?.wac ?? null,
    recomputedAt: row?.recomputedAt ?? null,
  };
}
