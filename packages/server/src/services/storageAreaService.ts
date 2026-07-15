/**
 * @module services/storageAreaService
 *
 * Storage areas are COUNT SHEETS, not ledgers.
 *
 * There is exactly one live on-hand number per item per venue, and it lives in
 * `stock_level` keyed (store_location_id, ingredient_id). Nothing in this file
 * touches it. What areas do is name the physical places within a site (Stock
 * Room, Bar, Walk-in) so the stocktake walk can be organised shelf-to-sheet,
 * and so each place can carry its own par.
 *
 * An item may be assigned to several areas (wine: Stock Room + Bar). At
 * approval its per-area counts SUM to the venue count — see the AREA-mode
 * branch of stockTakeService.
 */

import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  storageArea,
  ingredientStorageArea,
  ingredient,
  storeLocation,
} from "../db/schema.js";

export class StorageAreaError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "StorageAreaError";
  }
}

/**
 * Reserved: AREA-mode sessions surface a synthetic "Unassigned" group for items
 * that belong to no area, so nothing is silently missed. A real area by this
 * name would make that group ambiguous. The DB CHECK enforces this too — we
 * check here so the operator gets a sentence instead of a constraint violation.
 */
const RESERVED_AREA_NAME = "Unassigned";

export interface AreaItemAssignment {
  ingredientId: string;
  /** In the item's kitchen unit (= ingredient.base_unit). Null = no par set. */
  areaParLevel?: number | null;
  sortOrder?: number;
}

/** Assert the location belongs to the caller's org. Cross-org ids read as absent. */
async function assertLocationInOrg(locationId: string, orgId: number): Promise<void> {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(
      and(
        eq(storeLocation.storeLocationId, locationId),
        eq(storeLocation.organisationId, orgId),
      ),
    );
  if (!loc) throw new StorageAreaError("Location not found", 404);
}

/**
 * Load an area, scoped to the caller's org.
 * A cross-org area id is a 404, not a 403 — we don't confirm it exists.
 */
async function getAreaInOrg(areaId: string, orgId: number) {
  const [area] = await db
    .select({
      storageAreaId: storageArea.storageAreaId,
      storeLocationId: storageArea.storeLocationId,
      areaName: storageArea.areaName,
    })
    .from(storageArea)
    .where(and(eq(storageArea.storageAreaId, areaId), eq(storageArea.organisationId, orgId)));
  if (!area) throw new StorageAreaError("Storage area not found", 404);
  return area;
}

function assertNameAllowed(areaName: string): void {
  if (areaName.trim().toLowerCase() === RESERVED_AREA_NAME.toLowerCase()) {
    throw new StorageAreaError(
      `"${RESERVED_AREA_NAME}" is reserved — choose a different area name`,
      400,
    );
  }
}

/** Areas at a location, walk order, each with how many items are on its sheet. */
export async function listAreas(locationId: string, orgId: number, includeInactive = false) {
  await assertLocationInOrg(locationId, orgId);

  const where = includeInactive
    ? eq(storageArea.storeLocationId, locationId)
    : and(eq(storageArea.storeLocationId, locationId), eq(storageArea.activeInd, true));

  return db
    .select({
      storageAreaId: storageArea.storageAreaId,
      areaName: storageArea.areaName,
      sortOrder: storageArea.sortOrder,
      activeInd: storageArea.activeInd,
      itemCount: sql<number>`count(${ingredientStorageArea.ingredientStorageAreaId})::int`,
    })
    .from(storageArea)
    .leftJoin(
      ingredientStorageArea,
      eq(ingredientStorageArea.storageAreaId, storageArea.storageAreaId),
    )
    .where(where)
    .groupBy(storageArea.storageAreaId)
    .orderBy(asc(storageArea.sortOrder), asc(storageArea.areaName));
}

export async function createArea(
  locationId: string,
  orgId: number,
  areaName: string,
  sortOrder = 0,
) {
  await assertLocationInOrg(locationId, orgId);

  const name = areaName.trim();
  if (!name) throw new StorageAreaError("Give the area a name", 400);
  assertNameAllowed(name);

  const [existing] = await db
    .select({ id: storageArea.storageAreaId })
    .from(storageArea)
    .where(and(eq(storageArea.storeLocationId, locationId), eq(storageArea.areaName, name)));
  if (existing) {
    throw new StorageAreaError(`This location already has an area called "${name}"`, 409);
  }

  try {
    const [created] = await db
      .insert(storageArea)
      .values({ organisationId: orgId, storeLocationId: locationId, areaName: name, sortOrder })
      .returning();
    return created;
  } catch (err) {
    // The SELECT above is a friendliness check, not a lock: two admins creating
    // the same name at once both pass it, and the second one lands here on the
    // unique index. Without this, that operator gets a raw 500 instead of the
    // sentence explaining what happened. 23505 = unique_violation.
    if ((err as { code?: string })?.code === "23505") {
      throw new StorageAreaError(`This location already has an area called "${name}"`, 409);
    }
    throw err;
  }
}

export async function updateArea(
  areaId: string,
  orgId: number,
  data: { areaName?: string; sortOrder?: number; activeInd?: boolean },
) {
  const area = await getAreaInOrg(areaId, orgId);

  const patch: Record<string, unknown> = { updatedDttm: new Date() };

  if (data.areaName !== undefined) {
    const name = data.areaName.trim();
    if (!name) throw new StorageAreaError("Give the area a name", 400);
    assertNameAllowed(name);
    if (name !== area.areaName) {
      const [clash] = await db
        .select({ id: storageArea.storageAreaId })
        .from(storageArea)
        .where(
          and(
            eq(storageArea.storeLocationId, area.storeLocationId),
            eq(storageArea.areaName, name),
          ),
        );
      if (clash) {
        throw new StorageAreaError(`This location already has an area called "${name}"`, 409);
      }
    }
    patch.areaName = name;
  }
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.activeInd !== undefined) patch.activeInd = data.activeInd;

  // Scope the mutation by both areaId and orgId — the prior SELECT is an auth
  // check, but CLAUDE.md requires mutations to carry their own scope so a
  // row whose org-membership changed between the SELECT and the UPDATE can
  // never be written cross-tenant.
  const [updated] = await db
    .update(storageArea)
    .set(patch)
    .where(and(eq(storageArea.storageAreaId, areaId), eq(storageArea.organisationId, orgId)))
    .returning();
  return updated;
}

/**
 * Soft delete. Assignments and any count history that references this area stay
 * intact — a hard delete would orphan past stock-take lines. Deactivation
 * affects future sessions only.
 */
export async function deactivateArea(areaId: string, orgId: number) {
  await getAreaInOrg(areaId, orgId);
  // Scope the mutation by both areaId and orgId (same reason as updateArea above).
  const [updated] = await db
    .update(storageArea)
    .set({ activeInd: false, updatedDttm: new Date() })
    .where(and(eq(storageArea.storageAreaId, areaId), eq(storageArea.organisationId, orgId)))
    .returning();
  return updated;
}

/** The items on one area's sheet, in shelf-to-sheet order. */
export async function listAreaItems(areaId: string, orgId: number) {
  await getAreaInOrg(areaId, orgId);
  return db
    .select({
      ingredientId: ingredientStorageArea.ingredientId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      areaParLevel: ingredientStorageArea.areaParLevel,
      sortOrder: ingredientStorageArea.sortOrder,
    })
    .from(ingredientStorageArea)
    .innerJoin(ingredient, eq(ingredient.ingredientId, ingredientStorageArea.ingredientId))
    .where(eq(ingredientStorageArea.storageAreaId, areaId))
    .orderBy(asc(ingredientStorageArea.sortOrder), asc(ingredient.ingredientName));
}

/**
 * Replace an area's item assignments wholesale (the admin picker saves the full
 * set). Runs in one transaction so a half-applied sheet can never be observed.
 */
export async function setAreaItems(
  areaId: string,
  orgId: number,
  items: AreaItemAssignment[],
) {
  await getAreaInOrg(areaId, orgId);

  const ingredientIds = items.map((i) => i.ingredientId);
  if (new Set(ingredientIds).size !== ingredientIds.length) {
    throw new StorageAreaError("An item can only appear once on an area's sheet", 400);
  }

  // Every item must be in the caller's org. Checked as a set so a cross-org id
  // can't ride along in a batch.
  if (ingredientIds.length > 0) {
    const owned = await db
      .select({ id: ingredient.ingredientId })
      .from(ingredient)
      .where(and(inArray(ingredient.ingredientId, ingredientIds), eq(ingredient.organisationId, orgId)));
    if (owned.length !== ingredientIds.length) {
      throw new StorageAreaError("One or more items were not found", 404);
    }
  }

  for (const item of items) {
    if (item.areaParLevel != null && item.areaParLevel < 0) {
      throw new StorageAreaError("Par level can't be negative", 400);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(ingredientStorageArea).where(eq(ingredientStorageArea.storageAreaId, areaId));
    if (items.length > 0) {
      await tx.insert(ingredientStorageArea).values(
        items.map((item, idx) => ({
          storageAreaId: areaId,
          ingredientId: item.ingredientId,
          areaParLevel: item.areaParLevel != null ? String(item.areaParLevel) : null,
          sortOrder: item.sortOrder ?? idx,
        })),
      );
    }
  });

  return listAreaItems(areaId, orgId);
}

/**
 * Which active areas each item is assigned to, for one location.
 *
 * The count sheet decides its own membership CLIENT-SIDE, mirroring how
 * CATEGORY mode already filters (CategoryCounter.tsx) — so AREA and CATEGORY
 * sheets share one predicate and can't drift apart. This is the map that
 * filter reads: items absent from it are the "Unassigned" bucket.
 *
 * One query per location, never N+1 per ingredient.
 */
export async function getAssignmentMap(
  locationId: string,
  orgId: number,
): Promise<Record<string, string[]>> {
  await assertLocationInOrg(locationId, orgId);

  const rows = await db
    .select({
      ingredientId: ingredientStorageArea.ingredientId,
      storageAreaId: ingredientStorageArea.storageAreaId,
    })
    .from(ingredientStorageArea)
    .innerJoin(storageArea, eq(storageArea.storageAreaId, ingredientStorageArea.storageAreaId))
    .where(and(eq(storageArea.storeLocationId, locationId), eq(storageArea.activeInd, true)));

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    (map[row.ingredientId] ??= []).push(row.storageAreaId);
  }
  return map;
}
