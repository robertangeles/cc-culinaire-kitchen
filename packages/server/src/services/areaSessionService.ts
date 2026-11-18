/**
 * @module services/areaSessionService
 *
 * Rules for stock takes counted by storage area instead of item category
 * (mobile release 1, X1). In an AREA session the category rows ARE area names,
 * plus the reserved "Unassigned" bucket for items that sit in no area.
 *
 * - D3: a session holds a chosen set of areas, but areas that share an item must
 *   be opened together, and the session advances only when every area is submitted.
 * - D8: an area cannot be submitted until each item it shares with another area
 *   has a count on this area's own sheet (zero is a count).
 * - D9: an area's item list cannot be edited while an area count is open.
 *
 * Depends on the DB, schema and error classes only, so both the session and the
 * count services can import it without a cycle.
 */

import { eq, and, inArray, notInArray, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  storageArea,
  ingredientStorageArea,
  locationIngredient,
  ingredient,
} from "../db/schema.js";
import { ConflictError, ValidationError } from "./stockTakeErrors.js";

/** Reserved name of the bucket for items that belong to no area (see storage_area_name_not_reserved). */
export const UNASSIGNED_AREA = "Unassigned";

/** Session statuses in which a count is still being worked or reviewed. */
const FINISHED_STATUSES = ["APPROVED", "ARCHIVED"];

/** Active areas at a location with the active ingredients assigned to each, as name -> item ids. */
async function loadAreaSheets(storeLocationId: string) {
  const areas = await db
    .select({ areaId: storageArea.storageAreaId, areaName: storageArea.areaName })
    .from(storageArea)
    .where(and(eq(storageArea.storeLocationId, storeLocationId), eq(storageArea.activeInd, true)))
    .orderBy(asc(storageArea.sortOrder), asc(storageArea.areaName));

  const rows = areas.length
    ? await db
        .select({
          areaName: storageArea.areaName,
          ingredientId: ingredientStorageArea.ingredientId,
          ingredientName: ingredient.ingredientName,
        })
        .from(ingredientStorageArea)
        .innerJoin(storageArea, eq(storageArea.storageAreaId, ingredientStorageArea.storageAreaId))
        .innerJoin(ingredient, eq(ingredient.ingredientId, ingredientStorageArea.ingredientId))
        .where(inArray(ingredientStorageArea.storageAreaId, areas.map((a) => a.areaId)))
    : [];

  const itemAreas = new Map<string, Set<string>>(); // ingredient -> area names
  const itemNames = new Map<string, string>();
  for (const r of rows) {
    itemNames.set(r.ingredientId, r.ingredientName);
    const set = itemAreas.get(r.ingredientId) ?? new Set<string>();
    set.add(r.areaName);
    itemAreas.set(r.ingredientId, set);
  }
  return { areaNames: areas.map((a) => a.areaName), itemAreas, itemNames };
}

/**
 * The area names a new area session will contain.
 * @param requested - chosen area names; empty or omitted means every active area plus "Unassigned".
 * @throws ValidationError for an unknown name or a location with nothing to count.
 * @throws ConflictError when a chosen area shares an item with an area that was not chosen (D3).
 */
export async function resolveSessionAreaNames(storeLocationId: string, requested?: string[]): Promise<string[]> {
  const { areaNames, itemAreas, itemNames } = await loadAreaSheets(storeLocationId);

  const activeItems = await db
    .select({ ingredientId: locationIngredient.ingredientId })
    .from(locationIngredient)
    .where(and(eq(locationIngredient.storeLocationId, storeLocationId), eq(locationIngredient.activeInd, true)));
  const hasUnassigned = activeItems.some((i) => !itemAreas.has(i.ingredientId));

  const all = hasUnassigned ? [...areaNames, UNASSIGNED_AREA] : areaNames;
  if (all.length === 0) {
    throw new ValidationError("This location has no storage areas or items to count. Set up storage areas first.");
  }

  const chosen = requested && requested.length > 0 ? [...new Set(requested)] : all;
  const unknown = chosen.filter((n) => !all.includes(n));
  if (unknown.length > 0) throw new ValidationError(`Unknown storage area: ${unknown.join(", ")}`);

  // Closed set: an item that sits in a chosen area must not also sit in an area left out.
  const chosenSet = new Set(chosen);
  const leftOut = new Set<string>();
  const sharedItems: string[] = [];
  for (const [ingredientId, areas] of itemAreas) {
    const inChosen = [...areas].some((a) => chosenSet.has(a));
    const outside = [...areas].filter((a) => !chosenSet.has(a));
    if (inChosen && outside.length > 0) {
      outside.forEach((a) => leftOut.add(a));
      sharedItems.push(itemNames.get(ingredientId) ?? ingredientId);
    }
  }
  if (leftOut.size > 0) {
    const shown = sharedItems.slice(0, 5).join(", ") + (sharedItems.length > 5 ? ` and ${sharedItems.length - 5} more` : "");
    throw new ConflictError(
      `Add ${[...leftOut].join(", ")} to this count: areas that share an item must be counted together (shared: ${shown})`,
    );
  }
  return chosen;
}

/** True when the session counts by area. */
export async function isAreaSession(sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({ countMode: stockTakeSession.countMode })
    .from(stockTakeSession)
    .where(eq(stockTakeSession.sessionId, sessionId));
  return s?.countMode === "AREA";
}

/**
 * D8: block submitting an area until every item it shares with another area in this
 * session has a count on this area's own sheet. Zero counts. Items in one area only
 * may still be skipped, as in a category count. No-op for category sessions.
 * @throws ValidationError listing the items still to count.
 */
export async function assertAreaSheetComplete(sessionId: string, categoryName: string): Promise<void> {
  const [session] = await db
    .select({ countMode: stockTakeSession.countMode, storeLocationId: stockTakeSession.storeLocationId })
    .from(stockTakeSession)
    .where(eq(stockTakeSession.sessionId, sessionId));
  if (!session || session.countMode !== "AREA" || categoryName === UNASSIGNED_AREA) return;

  const sessionAreas = await db
    .select({ name: stockTakeCategory.categoryName })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, sessionId));
  const inSession = new Set(sessionAreas.map((c) => c.name));

  const { itemAreas, itemNames } = await loadAreaSheets(session.storeLocationId);
  const shared = [...itemAreas]
    .filter(([, areas]) => areas.has(categoryName) && [...areas].filter((a) => inSession.has(a)).length > 1)
    .map(([ingredientId]) => ingredientId);
  if (shared.length === 0) return;

  const [cat] = await db
    .select({ categoryId: stockTakeCategory.categoryId })
    .from(stockTakeCategory)
    .where(and(eq(stockTakeCategory.sessionId, sessionId), eq(stockTakeCategory.categoryName, categoryName)));
  if (!cat) return;

  const counted = await db
    .select({ ingredientId: stockTakeLine.ingredientId })
    .from(stockTakeLine)
    .where(and(eq(stockTakeLine.categoryId, cat.categoryId), inArray(stockTakeLine.ingredientId, shared)));
  const done = new Set(counted.map((l) => l.ingredientId));
  const missing = shared.filter((id) => !done.has(id)).map((id) => itemNames.get(id) ?? id);
  if (missing.length > 0) {
    throw new ValidationError(
      `Count these items in ${categoryName} before submitting (enter 0 if none are there): ${missing.join(", ")}`,
    );
  }
}

/**
 * D4: true when this category row is an area of an AREA session and the item sits in more than
 * one of that session's areas. Such a line is only one share of the item's stock, so it must not
 * be compared with the whole book (that would show a false shortage); the review screen and the
 * phone compare the item's total instead (shared `ingredientVariance`).
 */
export async function isSharedAreaItem(categoryId: string, ingredientId: string): Promise<boolean> {
  const [cat] = await db
    .select({
      sessionId: stockTakeCategory.sessionId,
      countMode: stockTakeSession.countMode,
      storeLocationId: stockTakeSession.storeLocationId,
    })
    .from(stockTakeCategory)
    .innerJoin(stockTakeSession, eq(stockTakeSession.sessionId, stockTakeCategory.sessionId))
    .where(eq(stockTakeCategory.categoryId, categoryId));
  if (!cat || cat.countMode !== "AREA") return false;

  const sessionAreas = await db
    .select({ name: stockTakeCategory.categoryName })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.sessionId, cat.sessionId));

  const { itemAreas } = await loadAreaSheets(cat.storeLocationId);
  const areas = itemAreas.get(ingredientId);
  if (!areas) return false;
  const inSession = new Set(sessionAreas.map((c) => c.name));
  return [...areas].filter((a) => inSession.has(a)).length > 1;
}

/** D9: true while an area count at this location is open, in review or flagged. */
export async function hasOpenAreaSession(storeLocationId: string): Promise<boolean> {
  const rows = await db
    .select({ sessionId: stockTakeSession.sessionId })
    .from(stockTakeSession)
    .where(
      and(
        eq(stockTakeSession.storeLocationId, storeLocationId),
        eq(stockTakeSession.countMode, "AREA"),
        notInArray(stockTakeSession.sessionStatus, FINISHED_STATUSES),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
