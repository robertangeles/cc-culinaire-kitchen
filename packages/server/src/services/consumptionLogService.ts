/**
 * @module services/consumptionLogService
 *
 * Fire-and-forget stock depletion service. Entries deduct stock
 * immediately with no approval workflow. HQ reviews via daily digest.
 */

import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import { db } from "../db/index.js";
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
  ingredientId: string;
  quantity: number;
  unit: string;
  reason: string;
  notes?: string;
  shift?: string;
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
 * Deduct `deductQty` from the stock_level row for the given location +
 * ingredient. Creates a negative row if none exists. Uses optimistic
 * locking with up to 2 retries on version conflict.
 */
async function deductStockLevel(
  storeLocationId: string,
  ingredientId: string,
  deductQty: number,
  retryCount = 0,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (existing.length === 0) {
    // No stock level record — create with negative qty
    await db.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(-deductQty),
      version: 0,
    });
    return;
  }

  const current = existing[0];
  const newQty = Number(current.currentQty) - deductQty;
  const result = await db
    .update(stockLevel)
    .set({
      currentQty: String(newQty),
      version: current.version + 1,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockLevel.stockLevelId, current.stockLevelId),
        eq(stockLevel.version, current.version),
      ),
    )
    .returning();

  if (result.length === 0 && retryCount < 2) {
    await deductStockLevel(storeLocationId, ingredientId, deductQty, retryCount + 1);
  }
}

/**
 * Restore (add back) `restoreQty` to the stock_level row. Mirror of
 * deductStockLevel but adds instead of subtracts.
 */
async function restoreStockLevel(
  storeLocationId: string,
  ingredientId: string,
  restoreQty: number,
  retryCount = 0,
): Promise<void> {
  const existing = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    );

  if (existing.length === 0) {
    // No stock level record — create with positive qty
    await db.insert(stockLevel).values({
      storeLocationId,
      ingredientId,
      currentQty: String(restoreQty),
      version: 0,
    });
    return;
  }

  const current = existing[0];
  const newQty = Number(current.currentQty) + restoreQty;
  const result = await db
    .update(stockLevel)
    .set({
      currentQty: String(newQty),
      version: current.version + 1,
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(stockLevel.stockLevelId, current.stockLevelId),
        eq(stockLevel.version, current.version),
      ),
    )
    .returning();

  if (result.length === 0 && retryCount < 2) {
    await restoreStockLevel(storeLocationId, ingredientId, restoreQty, retryCount + 1);
  }
}

// ---------------------------------------------------------------------------
// 1. logConsumption
// ---------------------------------------------------------------------------

export async function logConsumption(
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
    throw new Error("Ingredient not found or does not belong to this organisation");
  }

  // Create consumption log row
  const [entry] = await db
    .insert(consumptionLog)
    .values({
      organisationId: orgId,
      storeLocationId: locationId,
      ingredientId: data.ingredientId,
      userId,
      quantity: String(data.quantity),
      unit: data.unit,
      reason: data.reason,
      notes: data.notes ?? null,
      shift: data.shift ?? null,
    })
    .returning();

  // Deduct from stock level immediately
  await deductStockLevel(locationId, data.ingredientId, data.quantity);

  return entry;
}

// ---------------------------------------------------------------------------
// 2. listConsumptionLogs
// ---------------------------------------------------------------------------

export async function listConsumptionLogs(locationId: string, opts?: ListOpts) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conditions = [eq(consumptionLog.storeLocationId, locationId)];

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
      totalValue: sql<string>`coalesce(sum(${consumptionLog.quantity}::numeric * coalesce(${ingredient.unitCost}::numeric, 0)), 0)`,
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
      totalQty: sql<string>`sum(${consumptionLog.quantity}::numeric)`,
      unit: ingredient.baseUnit,
    })
    .from(consumptionLog)
    .innerJoin(ingredient, eq(consumptionLog.ingredientId, ingredient.ingredientId))
    .where(baseConditions)
    .groupBy(consumptionLog.ingredientId, ingredient.ingredientName, ingredient.baseUnit)
    .orderBy(sql`sum(${consumptionLog.quantity}::numeric) desc`)
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
  // Fetch existing log
  const [existing] = await db
    .select()
    .from(consumptionLog)
    .where(
      and(
        eq(consumptionLog.consumptionLogId, logId),
        eq(consumptionLog.organisationId, orgId),
      ),
    );

  if (!existing) {
    throw new Error("Consumption log entry not found");
  }

  // Verify user is the logger OR is org admin
  if (existing.userId !== userId && !isAdmin) {
    throw new Error("Only the original logger or an admin can edit this entry");
  }

  // Verify logged_at is within 24 hours
  const hoursAgo = (Date.now() - new Date(existing.loggedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo > 24) {
    throw new Error("Cannot edit entries older than 24 hours");
  }

  // If quantity changed, adjust stock level
  if (data.quantity !== undefined && data.quantity !== Number(existing.quantity)) {
    const delta = data.quantity - Number(existing.quantity);
    if (delta > 0) {
      // New qty is larger — deduct the difference
      await deductStockLevel(existing.storeLocationId, existing.ingredientId, delta);
    } else {
      // New qty is smaller — restore the difference
      await restoreStockLevel(existing.storeLocationId, existing.ingredientId, Math.abs(delta));
    }
  }

  // Build update payload
  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.quantity !== undefined) updates.quantity = String(data.quantity);
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.reason !== undefined) updates.reason = data.reason;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.shift !== undefined) updates.shift = data.shift;

  const [updated] = await db
    .update(consumptionLog)
    .set(updates)
    .where(eq(consumptionLog.consumptionLogId, logId))
    .returning();

  return updated;
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
  // Fetch existing log
  const [existing] = await db
    .select()
    .from(consumptionLog)
    .where(
      and(
        eq(consumptionLog.consumptionLogId, logId),
        eq(consumptionLog.organisationId, orgId),
      ),
    );

  if (!existing) {
    throw new Error("Consumption log entry not found");
  }

  // Verify user is the logger OR is org admin
  if (existing.userId !== userId && !isAdmin) {
    throw new Error("Only the original logger or an admin can delete this entry");
  }

  // Verify logged_at is within 24 hours
  const hoursAgo = (Date.now() - new Date(existing.loggedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo > 24) {
    throw new Error("Cannot delete entries older than 24 hours");
  }

  // Restore stock
  await restoreStockLevel(
    existing.storeLocationId,
    existing.ingredientId,
    Number(existing.quantity),
  );

  // Delete the row
  const [deleted] = await db
    .delete(consumptionLog)
    .where(eq(consumptionLog.consumptionLogId, logId))
    .returning();

  return deleted;
}

// ---------------------------------------------------------------------------
// 6. getConsumptionByIngredient
// ---------------------------------------------------------------------------

export async function getConsumptionByIngredient(
  ingredientId: string,
  locationId: string,
  days: number,
) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${consumptionLog.loggedAt})::date`,
      totalQty: sql<string>`sum(${consumptionLog.quantity}::numeric)`,
    })
    .from(consumptionLog)
    .where(
      and(
        eq(consumptionLog.ingredientId, ingredientId),
        eq(consumptionLog.storeLocationId, locationId),
        gte(consumptionLog.loggedAt, startDate),
      ),
    )
    .groupBy(sql`date_trunc('day', ${consumptionLog.loggedAt})::date`)
    .orderBy(sql`date_trunc('day', ${consumptionLog.loggedAt})::date`);

  return rows.map((row) => ({
    date: String(row.date),
    totalQty: Number(row.totalQty),
  }));
}
