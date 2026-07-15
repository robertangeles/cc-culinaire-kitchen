/**
 * @module services/stockMovementService
 *
 * Records physical moves between storage areas — "4 bottles, Stock Room → Bar".
 *
 * ZERO STOCK EFFECT. This is the entire point of the module, not an omission:
 * bottles carried to the bar are still on site and still sellable, so venue
 * stock must not move. Nothing here may import or write `stockLevel`.
 *
 * Why it exists: before this, the only vocabulary for "restocked the bar" was
 * to CONSUME the stock. That deducted it once at the move and again when it
 * sold, and the gap surfaced as phantom yield variance. A move is an audit
 * note, not a stock mutation.
 */

import { eq, and, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import {
  stockMovement,
  storageArea,
  ingredient,
  storeLocation,
  user,
} from "../db/schema.js";
import { resolveToBase } from "./unitConversionService.js";

export class StockMovementError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "StockMovementError";
  }
}

export interface CreateMovementInput {
  ingredientId: string;
  fromStorageAreaId: string;
  toStorageAreaId: string;
  quantity: number;
  unit: string;
  notes?: string;
}

/**
 * Record a move. Validates that both areas are real, active, at the SAME
 * location, and in the caller's org — a move that crossed sites would be an
 * inventory transfer, which is a different thing with a real stock effect.
 */
export async function createMovement(
  locationId: string,
  orgId: number,
  userId: number,
  input: CreateMovementInput,
) {
  if (!(input.quantity > 0)) {
    throw new StockMovementError("Enter how much is moving", 400);
  }
  if (input.fromStorageAreaId === input.toStorageAreaId) {
    throw new StockMovementError("Pick two different areas", 400);
  }

  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)));
  if (!loc) throw new StockMovementError("Location not found", 404);

  const [ing] = await db
    .select({ id: ingredient.ingredientId })
    .from(ingredient)
    .where(and(eq(ingredient.ingredientId, input.ingredientId), eq(ingredient.organisationId, orgId)));
  if (!ing) throw new StockMovementError("Item not found", 404);

  // Both areas must sit at THIS location and org. Fetched together so a
  // cross-location or cross-org id can't slip through on one side.
  for (const [areaId, label] of [
    [input.fromStorageAreaId, "from"],
    [input.toStorageAreaId, "to"],
  ] as const) {
    const [area] = await db
      .select({ id: storageArea.storageAreaId, activeInd: storageArea.activeInd })
      .from(storageArea)
      .where(
        and(
          eq(storageArea.storageAreaId, areaId),
          eq(storageArea.storeLocationId, locationId),
          eq(storageArea.organisationId, orgId),
        ),
      );
    if (!area) {
      throw new StockMovementError(
        label === "from" ? "That 'from' area isn't at this location" : "That 'to' area isn't at this location",
        404,
      );
    }
    if (!area.activeInd) {
      throw new StockMovementError("That area is no longer in use", 400);
    }
  }

  // Kitchen-unit truth for the feed and any later rollup, exactly as
  // consumption_log.base_qty is populated. Throws on an incompatible unit.
  const { baseQty } = await resolveToBase(input.ingredientId, input.quantity, input.unit);

  const [created] = await db
    .insert(stockMovement)
    .values({
      organisationId: orgId,
      storeLocationId: locationId,
      ingredientId: input.ingredientId,
      fromStorageAreaId: input.fromStorageAreaId,
      toStorageAreaId: input.toStorageAreaId,
      quantity: String(input.quantity),
      unit: input.unit,
      baseQty: String(baseQty),
      userId,
      notes: input.notes?.trim() || null,
    })
    .returning();

  // Deliberately nothing else. No stock write. See the module docblock.
  return created;
}

/** Movements at a location, newest first. Optionally narrowed to one item. */
export async function listMovements(
  locationId: string,
  orgId: number,
  opts: { ingredientId?: string; limit?: number } = {},
) {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)));
  if (!loc) throw new StockMovementError("Location not found", 404);

  const fromArea = alias(storageArea, "from_area");
  const toArea = alias(storageArea, "to_area");

  const where = opts.ingredientId
    ? and(
        eq(stockMovement.storeLocationId, locationId),
        eq(stockMovement.ingredientId, opts.ingredientId),
      )
    : eq(stockMovement.storeLocationId, locationId);

  return db
    .select({
      stockMovementId: stockMovement.stockMovementId,
      ingredientId: stockMovement.ingredientId,
      ingredientName: ingredient.ingredientName,
      quantity: stockMovement.quantity,
      unit: stockMovement.unit,
      fromAreaName: fromArea.areaName,
      toAreaName: toArea.areaName,
      userName: user.userName,
      notes: stockMovement.notes,
      movedAt: stockMovement.movedAt,
    })
    .from(stockMovement)
    .innerJoin(ingredient, eq(ingredient.ingredientId, stockMovement.ingredientId))
    .innerJoin(fromArea, eq(fromArea.storageAreaId, stockMovement.fromStorageAreaId))
    .innerJoin(toArea, eq(toArea.storageAreaId, stockMovement.toStorageAreaId))
    .innerJoin(user, eq(user.userId, stockMovement.userId))
    .where(where)
    .orderBy(desc(stockMovement.movedAt))
    .limit(opts.limit ?? 100);
}
