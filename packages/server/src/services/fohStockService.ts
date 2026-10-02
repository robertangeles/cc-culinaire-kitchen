/**
 * @module services/fohStockService
 *
 * Front-of-house (FOH) shelf stock operations for FOH consumables.
 *
 * The warehouse/back-of-house quantity lives in `stock_level` zone='BOH'
 * (unchanged — receiving, transfers, stock takes all still write it). This
 * service manages the second bucket, zone='FOH', which a POS sale deducts:
 *
 *   moveToFoh        "stock the fridge": BOH -> FOH within one location
 *   recountFoh       reconcile the FOH shelf to a counted value
 *   suggestFohRestock  restock-to-par suggestions for the FOH tab
 *   getFohStock      per-item BOH + FOH view for the FOH tab
 *
 * All quantities are in the ingredient's base_unit.
 */

import { and, eq, sql } from "drizzle-orm";
import type { StockZoneKey } from "@culinaire/shared";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import { stockLevel, ingredient } from "../db/schema.js";
import { addStock, deductStock } from "./stockService.js";

/** Domain error carrying an HTTP status for the controller to map. */
export class FohError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "FohError";
  }
}

/** Read the current qty for one zone. Returns 0 when no row exists yet. */
async function getZoneQty(
  storeLocationId: string,
  ingredientId: string,
  zone: StockZoneKey,
  tx: DbOrTx = db,
): Promise<number> {
  const [row] = await tx
    .select({ currentQty: stockLevel.currentQty })
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
        eq(stockLevel.zone, zone),
      ),
    );
  return row ? Number(row.currentQty) : 0;
}

/** Verify the ingredient exists in the org and is a FOH consumable. */
async function assertFohConsumable(orgId: number, ingredientId: string): Promise<void> {
  const [ing] = await db
    .select({ itemType: ingredient.itemType })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.ingredientId, ingredientId),
        eq(ingredient.organisationId, orgId),
      ),
    );
  if (!ing) throw new FohError("Item not found", 404);
  if (ing.itemType !== "FOH_CONSUMABLE") {
    throw new FohError("Only FOH consumables can be stocked to the front of house", 400);
  }
}

/**
 * Move `qty` from BOH to FOH at one location ("stock the fridge").
 * Rejects if BOH doesn't hold enough — unlike a sale (which already happened),
 * you cannot move stock you don't have.
 */
export async function moveToFoh(
  orgId: number,
  storeLocationId: string,
  ingredientId: string,
  qty: number,
): Promise<{ ingredientId: string; moved: number; bohQty: number; fohQty: number }> {
  if (!(qty > 0)) throw new FohError("Quantity must be greater than 0", 400);
  await assertFohConsumable(orgId, ingredientId);

  return db.transaction(async (tx) => {
    const bohQty = await getZoneQty(storeLocationId, ingredientId, "BOH", tx);
    if (bohQty < qty) {
      throw new FohError(
        `Not enough back-of-house stock to move (have ${bohQty}, need ${qty})`,
        400,
      );
    }
    await deductStock(storeLocationId, ingredientId, qty, tx, "BOH");
    await addStock(storeLocationId, ingredientId, qty, tx, "FOH");
    const fohQty = await getZoneQty(storeLocationId, ingredientId, "FOH", tx);
    return { ingredientId, moved: qty, bohQty: bohQty - qty, fohQty };
  });
}

/**
 * Reconcile the FOH shelf to a counted value (lightweight — not the full
 * stock-take session workflow). Sets FOH qty to `countedQty` and returns the
 * variance for the audit trail.
 * ponytail: simple reset; upgrade to a review/approval session if FOH counts
 * ever need sign-off.
 */
export async function recountFoh(
  orgId: number,
  storeLocationId: string,
  ingredientId: string,
  countedQty: number,
  userId: number,
): Promise<{ ingredientId: string; previousQty: number; countedQty: number; varianceQty: number }> {
  if (!(countedQty >= 0)) throw new FohError("Counted quantity cannot be negative", 400);
  await assertFohConsumable(orgId, ingredientId);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        stockLevelId: stockLevel.stockLevelId,
        currentQty: stockLevel.currentQty,
        version: stockLevel.version,
      })
      .from(stockLevel)
      .where(
        and(
          eq(stockLevel.storeLocationId, storeLocationId),
          eq(stockLevel.ingredientId, ingredientId),
          eq(stockLevel.zone, "FOH"),
        ),
      );

    const previousQty = existing ? Number(existing.currentQty) : 0;

    if (!existing) {
      await tx.insert(stockLevel).values({
        storeLocationId,
        ingredientId,
        zone: "FOH",
        currentQty: String(countedQty),
        lastCountedDttm: new Date(),
        lastCountedByUserId: userId,
        version: 0,
      });
    } else {
      await tx
        .update(stockLevel)
        .set({
          currentQty: String(countedQty),
          lastCountedDttm: new Date(),
          lastCountedByUserId: userId,
          version: existing.version + 1,
          updatedDttm: new Date(),
        })
        .where(eq(stockLevel.stockLevelId, existing.stockLevelId));
    }

    return { ingredientId, previousQty, countedQty, varianceQty: countedQty - previousQty };
  });
}

/**
 * Suggest BOH->FOH restock quantities to bring each FOH consumable up to its
 * FOH par. Only items below par are returned; the suggestion is capped by the
 * BOH quantity actually available to move.
 */
export async function suggestFohRestock(storeLocationId: string) {
  const rows = await db.execute<{
    ingredient_id: string;
    ingredient_name: string;
    ingredient_category: string;
    base_unit: string;
    foh_par_level: string | null;
    foh_qty: string | null;
    boh_qty: string | null;
  }>(sql`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      i.ingredient_category,
      i.base_unit,
      li.foh_par_level,
      foh.current_qty AS foh_qty,
      boh.current_qty AS boh_qty
    FROM ingredient i
    JOIN location_ingredient li
      ON li.ingredient_id = i.ingredient_id
      AND li.store_location_id = ${storeLocationId}::uuid
    LEFT JOIN stock_level foh
      ON foh.ingredient_id = i.ingredient_id
      AND foh.store_location_id = ${storeLocationId}::uuid
      AND foh.zone = 'FOH'
    LEFT JOIN stock_level boh
      ON boh.ingredient_id = i.ingredient_id
      AND boh.store_location_id = ${storeLocationId}::uuid
      AND boh.zone = 'BOH'
    WHERE i.item_type = 'FOH_CONSUMABLE'
      AND i.deleted_at IS NULL
      AND (li.active_ind IS NULL OR li.active_ind = TRUE)
      AND li.foh_par_level IS NOT NULL
      AND li.foh_par_level::numeric > COALESCE(foh.current_qty, 0)::numeric
  `);

  return rows.map((r) => {
    const fohPar = Number(r.foh_par_level);
    const fohQty = Number(r.foh_qty ?? 0);
    const bohQty = Number(r.boh_qty ?? 0);
    const shortfall = fohPar - fohQty;
    const suggestedQty = Math.min(shortfall, bohQty); // can't move more than BOH holds
    return {
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      ingredientCategory: r.ingredient_category,
      baseUnit: r.base_unit,
      fohParLevel: fohPar,
      fohQty,
      bohQty,
      suggestedQty: Math.max(0, suggestedQty),
    };
  });
}

/**
 * Per-item BOH + FOH view for the FOH tab: every FOH consumable active at the
 * location, with both zone quantities, its FOH par, and a low-FOH flag.
 */
export async function getFohStock(storeLocationId: string) {
  const rows = await db.execute<{
    ingredient_id: string;
    ingredient_name: string;
    ingredient_category: string;
    base_unit: string;
    foh_par_level: string | null;
    foh_qty: string | null;
    boh_qty: string | null;
  }>(sql`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      i.ingredient_category,
      i.base_unit,
      li.foh_par_level,
      foh.current_qty AS foh_qty,
      boh.current_qty AS boh_qty
    FROM ingredient i
    JOIN location_ingredient li
      ON li.ingredient_id = i.ingredient_id
      AND li.store_location_id = ${storeLocationId}::uuid
    LEFT JOIN stock_level foh
      ON foh.ingredient_id = i.ingredient_id
      AND foh.store_location_id = ${storeLocationId}::uuid
      AND foh.zone = 'FOH'
    LEFT JOIN stock_level boh
      ON boh.ingredient_id = i.ingredient_id
      AND boh.store_location_id = ${storeLocationId}::uuid
      AND boh.zone = 'BOH'
    WHERE i.item_type = 'FOH_CONSUMABLE'
      AND i.deleted_at IS NULL
      AND (li.active_ind IS NULL OR li.active_ind = TRUE)
    ORDER BY i.ingredient_name
  `);

  return rows.map((r) => {
    const fohPar = r.foh_par_level !== null ? Number(r.foh_par_level) : null;
    const fohQty = Number(r.foh_qty ?? 0);
    return {
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      ingredientCategory: r.ingredient_category,
      baseUnit: r.base_unit,
      fohParLevel: fohPar,
      fohQty,
      bohQty: Number(r.boh_qty ?? 0),
      lowFoh: fohPar !== null && fohPar > 0 && fohQty < fohPar,
    };
  });
}
