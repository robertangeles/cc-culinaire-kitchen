/**
 * @module services/consumptionLogService
 *
 * Fire-and-forget stock depletion service. Entries deduct stock
 * immediately with no approval workflow. HQ reviews via daily digest.
 */

import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import type { StockZoneKey } from "@culinaire/shared";
import { db } from "../db/index.js";
import { resolveToBase } from "./unitConversionService.js";
import { AppError } from "../utils/appError.js";
import { insertOnce } from "../utils/retrySafe.js";
import type { DbOrTx } from "./auditService.js";
import {
  consumptionLog,
  ingredient,
  stockLevel,
  user,
  storeLocation,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogConsumptionData {
  /** Chosen by the phone so a retried send finds its own entry instead of deducting the stock twice. */
  consumptionLogId?: string;
  ingredientId: string;
  /**
   * Catalog-spine Phase 4 (B1): optional link to the menu item that drove
   * this consumption event. Populated when the chef logs from the
   * ConsumptionLogger with the dish dropdown selected. Powers per-dish
   * yield variance — actual food cost = SUM(quantity × WAC) WHERE
   * menu_item_id = thisDish. Null is fine for free-form logs (waste,
   * staff meals, R&D) that aren't dish-attributable.
   */
  menuItemId?: string | null;
  quantity: number;
  unit: string;
  reason: string;
  notes?: string;
  shift?: string;
  /** Which stock zone to deduct from. Defaults to 'BOH'. Pass 'FOH' for front-of-house waste. */
  zone?: StockZoneKey;
}

interface ListOpts {
  startDate?: Date;
  endDate?: Date;
  reason?: string;
  limit?: number;
  offset?: number;
}

interface SummaryOpts {
  startDate?: Date;
  endDate?: Date;
}

interface EditData {
  quantity?: number;
  unit?: string;
  reason?: string;
  notes?: string;
  shift?: string;
}

// ---------------------------------------------------------------------------
// Stock helpers
// ---------------------------------------------------------------------------

/**
 * Change the stock_level row for the given location + ingredient + zone by `delta` (negative to deduct),
 * creating it if none exists. The row is locked while it changes, so concurrent entries take turns instead of
 * racing on its version; pass the surrounding transaction so the change commits with the entry that caused it.
 */
async function adjustStockLevel(
  storeLocationId: string,
  ingredientId: string,
  delta: number,
  zone: StockZoneKey = "BOH",
  tx: DbOrTx = db,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
        eq(stockLevel.zone, zone),
      ),
    )
    .for("update");

  if (!current) {
    await tx.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      zone,
      currentQty: String(delta),
      version: 0,
    });
    return;
  }

  const result = await tx
    .update(stockLevel)
    .set({
      currentQty: String(Number(current.currentQty) + delta),
      version: current.version + 1,
      updatedDttm: new Date(),
    })
    .where(and(eq(stockLevel.stockLevelId, current.stockLevelId), eq(stockLevel.version, current.version)))
    .returning();

  // Not reachable while the row is locked; if it ever is, fail loudly so the entry rolls back.
  if (result.length === 0) throw new AppError(409, "CONFLICT", "Stock changed while saving. Try again.");
}

const deductStockLevel = (loc: string, ing: string, qty: number, zone?: StockZoneKey, tx?: DbOrTx) =>
  adjustStockLevel(loc, ing, -qty, zone, tx);
const restoreStockLevel = (loc: string, ing: string, qty: number, zone?: StockZoneKey, tx?: DbOrTx) =>
  adjustStockLevel(loc, ing, qty, zone, tx);

// ---------------------------------------------------------------------------
// 1. logConsumption
// ---------------------------------------------------------------------------

export async function logConsumption(
  orgId: number,
  locationId: string,
  userId: number,
  data: LogConsumptionData,
) {
  return (await logConsumptionOnce(orgId, locationId, userId, data)).entry;
}

/**
 * Logs consumption and moves the stock in one transaction. `replay` is true when `data.consumptionLogId`
 * was already logged by this user: nothing is written and the stock is not touched a second time.
 */
export async function logConsumptionOnce(
  orgId: number,
  locationId: string,
  userId: number,
  data: LogConsumptionData,
) {
  // Validate ingredient exists and belongs to org
  const [ing] = await db
    .select()
    .from(ingredient)
    .where(
      and(
        eq(ingredient.ingredientId, data.ingredientId),
        eq(ingredient.organisationId, orgId),
      ),
    );

  if (!ing) {
    throw new AppError(404, "NOT_FOUND", "Ingredient not found or does not belong to this organisation");
  }

  // Resolve to the kitchen unit up-front: the deduction AND the stored
  // base_qty both come from this one conversion, so aggregations (summary,
  // forecasts) can sum base_qty safely across entries logged in mixed units.
  const { baseQty } = await resolveToBase(data.ingredientId, data.quantity, data.unit);

  return db.transaction(async (tx) => {
    const { row: entry, replay } = await insertOnce(
      userId,
      () =>
        tx
          .insert(consumptionLog)
          .values({
            consumptionLogId: data.consumptionLogId,
            organisationId: orgId,
            storeLocationId: locationId,
            ingredientId: data.ingredientId,
            menuItemId: data.menuItemId ?? null,
            userId,
            quantity: String(data.quantity),
            unit: data.unit,
            baseQty: String(baseQty),
            reason: data.reason,
            notes: data.notes ?? null,
            shift: data.shift ?? null,
          })
          .onConflictDoNothing({ target: consumptionLog.consumptionLogId })
          .returning(),
      async () => (await tx.select().from(consumptionLog).where(eq(consumptionLog.consumptionLogId, data.consumptionLogId!)))[0],
    );
    if (replay) return { entry, replay };

    // Adjust stock level — deduct for usage, add back for returns. The log row
    // keeps the entered qty + unit for display; base_qty is the kitchen-unit truth.
    const zone = data.zone ?? "BOH";
    if (data.reason === "return_to_stock") {
      await restoreStockLevel(locationId, data.ingredientId, baseQty, zone, tx);
    } else {
      await deductStockLevel(locationId, data.ingredientId, baseQty, zone, tx);
    }

    return { entry, replay };
  });
}

// ---------------------------------------------------------------------------
// 2. listConsumptionLogs
// ---------------------------------------------------------------------------

export async function listConsumptionLogs(locationId: string, orgId: number, opts?: ListOpts) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conditions = [
    eq(consumptionLog.storeLocationId, locationId),
    eq(consumptionLog.organisationId, orgId),
  ];

  if (opts?.startDate) {
    conditions.push(gte(consumptionLog.loggedAt, opts.startDate));
  }
  if (opts?.endDate) {
    conditions.push(lte(consumptionLog.loggedAt, opts.endDate));
  }
  if (opts?.reason) {
    conditions.push(eq(consumptionLog.reason, opts.reason));
  }

  const rows = await db
    .select({
      consumptionLogId: consumptionLog.consumptionLogId,
      ingredientId: consumptionLog.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      quantity: consumptionLog.quantity,
      unit: consumptionLog.unit,
      reason: consumptionLog.reason,
      notes: consumptionLog.notes,
      shift: consumptionLog.shift,
      loggedAt: consumptionLog.loggedAt,
      userId: consumptionLog.userId,
      userName: user.userName,
    })
    .from(consumptionLog)
    .innerJoin(ingredient, eq(consumptionLog.ingredientId, ingredient.ingredientId))
    .innerJoin(user, eq(consumptionLog.userId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(consumptionLog.loggedAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

// ---------------------------------------------------------------------------
// 3. getConsumptionSummary
// ---------------------------------------------------------------------------

export async function getConsumptionSummary(orgId: number, opts?: SummaryOpts) {
  const now = new Date();
  const startDate = opts?.startDate ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endDate = opts?.endDate ?? now;

  const baseConditions = and(
    eq(consumptionLog.organisationId, orgId),
    gte(consumptionLog.loggedAt, startDate),
    lte(consumptionLog.loggedAt, endDate),
  );

  // Per-location aggregation: totalEntries + totalValue
  const locationAgg = await db
    .select({
      storeLocationId: consumptionLog.storeLocationId,
      locationName: storeLocation.locationName,
      totalEntries: count(consumptionLog.consumptionLogId),
      // Sum the KITCHEN-unit qty (base_qty), never the as-entered quantity —
      // entries logged in mixed units (bottle vs ml) don't add. coalesce
      // covers legacy rows written before base_qty existed (backfilled).
      totalValue: sql<string>`coalesce(sum(coalesce(${consumptionLog.baseQty}, ${consumptionLog.quantity})::numeric * coalesce(${ingredient.unitCost}::numeric, 0)), 0)`,
    })
    .from(consumptionLog)
    .innerJoin(ingredient, eq(consumptionLog.ingredientId, ingredient.ingredientId))
    .innerJoin(storeLocation, eq(consumptionLog.storeLocationId, storeLocation.storeLocationId))
    .where(baseConditions)
    .groupBy(consumptionLog.storeLocationId, storeLocation.locationName);

  // By reason across the org
  const byReason = await db
    .select({
      reason: consumptionLog.reason,
      count: count(consumptionLog.consumptionLogId),
    })
    .from(consumptionLog)
    .where(baseConditions)
    .groupBy(consumptionLog.reason);

  // Top 10 most consumed items
  const topItems = await db
    .select({
      ingredientId: consumptionLog.ingredientId,
      ingredientName: ingredient.ingredientName,
      totalQty: sql<string>`sum(coalesce(${consumptionLog.baseQty}, ${consumptionLog.quantity})::numeric)`,
      unit: ingredient.baseUnit,
    })
    .from(consumptionLog)
    .innerJoin(ingredient, eq(consumptionLog.ingredientId, ingredient.ingredientId))
    .where(baseConditions)
    .groupBy(consumptionLog.ingredientId, ingredient.ingredientName, ingredient.baseUnit)
    .orderBy(sql`sum(coalesce(${consumptionLog.baseQty}, ${consumptionLog.quantity})::numeric) desc`)
    .limit(10);

  return {
    startDate,
    endDate,
    byLocation: locationAgg.map((row) => ({
      storeLocationId: row.storeLocationId,
      locationName: row.locationName,
      totalEntries: Number(row.totalEntries),
      totalValue: Number(row.totalValue),
    })),
    byReason: byReason.map((row) => ({
      reason: row.reason,
      count: Number(row.count),
    })),
    topItems: topItems.map((row) => ({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      totalQty: Number(row.totalQty),
      unit: row.unit,
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. editConsumptionLog
// ---------------------------------------------------------------------------

export async function editConsumptionLog(
  logId: string,
  orgId: number,
  userId: number,
  isAdmin: boolean,
  data: EditData,
) {
  return db.transaction(async (tx) => {
    // Fetch existing log
    const [existing] = await tx
      .select()
      .from(consumptionLog)
      .where(
        and(
          eq(consumptionLog.consumptionLogId, logId),
          eq(consumptionLog.organisationId, orgId),
        ),
      )
      .for("update");

    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Consumption log entry not found");
    }

    // Verify user is the logger OR is org admin
    if (existing.userId !== userId && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Only the original logger or an admin can edit this entry");
    }

    // Verify logged_at is within 24 hours
    const hoursAgo = (Date.now() - new Date(existing.loggedAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      throw new AppError(409, "EDIT_WINDOW_EXPIRED", "Cannot edit entries older than 24 hours");
    }

    // If quantity changed, adjust stock level (convert the delta from the
    // entry's unit to base — stock_level is in base units).
    if (data.quantity !== undefined && data.quantity !== Number(existing.quantity)) {
      const delta = data.quantity - Number(existing.quantity);
      const { baseQty: baseDelta } = await resolveToBase(existing.ingredientId, Math.abs(delta), existing.unit);
      if (delta > 0) {
        // New qty is larger — deduct the difference
        await deductStockLevel(existing.storeLocationId, existing.ingredientId, baseDelta, "BOH", tx);
      } else {
        // New qty is smaller — restore the difference
        await restoreStockLevel(existing.storeLocationId, existing.ingredientId, baseDelta, "BOH", tx);
      }
    }

    // Build update payload
    const updates: Record<string, unknown> = { updatedDttm: new Date() };
    if (data.quantity !== undefined) updates.quantity = String(data.quantity);
    if (data.unit !== undefined) updates.unit = data.unit;
    if (data.reason !== undefined) updates.reason = data.reason;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.shift !== undefined) updates.shift = data.shift;
    // Keep base_qty (the kitchen-unit truth aggregations sum) in step with any
    // quantity/unit change.
    if (data.quantity !== undefined || data.unit !== undefined) {
      const effQty = data.quantity ?? Number(existing.quantity);
      const effUnit = data.unit ?? existing.unit;
      const { baseQty: newBaseQty } = await resolveToBase(existing.ingredientId, effQty, effUnit);
      updates.baseQty = String(newBaseQty);
    }

    const [updated] = await tx
      .update(consumptionLog)
      .set(updates)
      .where(eq(consumptionLog.consumptionLogId, logId))
      .returning();

    return updated;
  });
}

// ---------------------------------------------------------------------------
// 5. deleteConsumptionLog
// ---------------------------------------------------------------------------

export async function deleteConsumptionLog(
  logId: string,
  orgId: number,
  userId: number,
  isAdmin: boolean,
) {
  return db.transaction(async (tx) => {
    // Fetch existing log
    const [existing] = await tx
      .select()
      .from(consumptionLog)
      .where(
        and(
          eq(consumptionLog.consumptionLogId, logId),
          eq(consumptionLog.organisationId, orgId),
        ),
      );

    // Gone already: a repeat of a delete that happened is a success, not a 404.
    if (!existing) return undefined;

    // Verify user is the logger OR is org admin
    if (existing.userId !== userId && !isAdmin) {
      throw new AppError(403, "FORBIDDEN", "Only the original logger or an admin can delete this entry");
    }

    // Verify logged_at is within 24 hours
    const hoursAgo = (Date.now() - new Date(existing.loggedAt).getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      throw new AppError(409, "EDIT_WINDOW_EXPIRED", "Cannot delete entries older than 24 hours");
    }

    // Delete first and restore only if this call removed the row: two deletes at once restore the stock once.
    const [deleted] = await tx
      .delete(consumptionLog)
      .where(eq(consumptionLog.consumptionLogId, logId))
      .returning();
    if (!deleted) return undefined;

    // Restore stock (convert the entry's qty from its unit to base)
    const { baseQty: baseRestore } = await resolveToBase(
      deleted.ingredientId,
      Number(deleted.quantity),
      deleted.unit,
    );
    await restoreStockLevel(deleted.storeLocationId, deleted.ingredientId, baseRestore, "BOH", tx);

    return deleted;
  });
}
