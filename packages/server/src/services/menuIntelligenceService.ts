/**
 * @module services/menuIntelligenceService
 *
 * Menu engineering calculation engine + CRUD for menu items.
 * Implements the Star/Plowhorse/Puzzle/Dog classification matrix.
 *
 * The costing and classification maths (line cost, food cost per sale, food cost %, contribution margin,
 * menu mix, Star/Plowhorse/Puzzle/Dog) live in packages/shared/src/utils/menuCosting.ts; this service
 * resolves units, reads and writes the rows.
 */

import pino from "pino";
import { db } from "../db/index.js";
import { menuItem, menuItemIngredient, menuCategorySetting, wasteLog, ingredient, locationIngredient, user } from "../db/schema.js";
import { eq, and, or, sql, gte, inArray, isNull } from "drizzle-orm";
import { AppError } from "../utils/appError.js";
import { menuReadable, assertCanManageMenuItem, type MenuScope } from "./menuAccess.js";
import { accessibleLocationIds } from "./locationContextService.js";
import type { TokenPayload } from "./authService.js";
import {
  IncompatibleUnitsError, classifyAgainstWholeMenu, menuMixPct, plateFoodCost, storedItemCosts, storedLineCost,
  summariseMenuAnalysis,
} from "@culinaire/shared";
import { resolveToBase } from "./unitConversionService.js";
import { recordOpsEvent } from "./brainCaptureService.js";

const logger = pino({ name: "menuIntelligence" });

// ---------------------------------------------------------------------------
// Menu Item CRUD
// ---------------------------------------------------------------------------

export async function createMenuItem(scope: MenuScope, data: {
  name: string;
  category: string;
  sellingPrice: string;
  servings?: number;
  servingsPerSale?: number;
  qFactorPct?: string;
}) {
  const [userRow] = await db
    .select({ selectedLocationId: user.selectedLocationId })
    .from(user)
    .where(eq(user.userId, scope.userId));

  const [item] = await db.insert(menuItem).values({
    userId: scope.userId,
    organisationId: scope.organisationId,
    storeLocationId: userRow?.selectedLocationId ?? null,
    name: data.name,
    category: data.category,
    sellingPrice: data.sellingPrice,
    servings: data.servings ?? 1,
    servingsPerSale: data.servingsPerSale ?? 1,
    qFactorPct: data.qFactorPct ?? "0",
  }).returning();

  // Brain memory (spec T12): remember this menu item was added.
  void recordOpsEvent({
    userId: scope.userId,
    sourceType: "menu",
    scope: scope.organisationId ? "org" : "user",
    organisationId: scope.organisationId,
    sourceRef: item.menuItemId,
    title: data.name,
    action: "created",
    itemName: data.name,
    category: data.category,
    sellingPrice: data.sellingPrice,
  });

  await persistClassification(scope);
  return item;
}

/** Every item of the caller's organisation (their own, while they have none), without the system-made FOH sale links. */
export async function getMenuItems(scope: MenuScope, category?: string, storeLocationId?: string) {
  const conditions = [
    menuReadable(scope),
    // Hide system-generated FOH direct-sale links — they're plumbing (a can's
    // 1:1 depletion), not dishes the operator engineers.
    sql`${menuItem.linkedIngredientId} IS NULL`,
  ];
  if (category) conditions.push(eq(menuItem.category, category));
  if (storeLocationId) conditions.push(eq(menuItem.storeLocationId, storeLocationId));

  return db.select().from(menuItem)
    .where(and(...conditions))
    .orderBy(menuItem.category, menuItem.name);
}

export async function getMenuItem(menuItemId: string, scope: MenuScope) {
  const [item] = await db.select().from(menuItem)
    .where(and(eq(menuItem.menuItemId, menuItemId), menuReadable(scope)))
    .limit(1);
  return item ?? null;
}

/** The item for a read, or 404 NOT_FOUND (another organisation's item is not found either). */
export async function requireMenuItem(menuItemId: string, scope: MenuScope) {
  const item = await getMenuItem(menuItemId, scope);
  if (!item) throw new AppError(404, "NOT_FOUND", "Item not found");
  return item;
}

/** The item for a change: 404 NOT_FOUND unless readable, 403 FORBIDDEN unless the caller made it or administers its organisation. */
export async function requireManageableMenuItem(menuItemId: string, scope: MenuScope) {
  const item = await requireMenuItem(menuItemId, scope);
  assertCanManageMenuItem(scope, item);
  return item;
}

export async function updateMenuItem(menuItemId: string, scope: MenuScope, data: Partial<{
  name: string;
  category: string;
  sellingPrice: string;
  servings: number;
  servingsPerSale: number;
  qFactorPct: string;
  unitsSold: number;
  periodStart: string;
  periodEnd: string;
}>) {
  await requireManageableMenuItem(menuItemId, scope);
  const setValues: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.name !== undefined) setValues.name = data.name;
  if (data.category !== undefined) setValues.category = data.category;
  if (data.sellingPrice !== undefined) setValues.sellingPrice = data.sellingPrice;
  if (data.servings !== undefined) setValues.servings = data.servings;
  if (data.servingsPerSale !== undefined) setValues.servingsPerSale = data.servingsPerSale;
  if (data.qFactorPct !== undefined) setValues.qFactorPct = data.qFactorPct;
  if (data.unitsSold !== undefined) setValues.unitsSold = data.unitsSold;
  if (data.periodStart !== undefined) setValues.periodStart = data.periodStart;
  if (data.periodEnd !== undefined) setValues.periodEnd = data.periodEnd;

  await db.update(menuItem).set(setValues).where(eq(menuItem.menuItemId, menuItemId));

  // Stored food_cost / food_cost_pct / contribution_margin depend on price,
  // servings, sales-unit size, and Q — refresh them when any of those change.
  // (Previously only ingredient edits recalculated, so a price change could
  // leave stale margins until the next recipe touch.)
  const costRelevantChange =
    data.sellingPrice !== undefined || data.servings !== undefined ||
    data.servingsPerSale !== undefined || data.qFactorPct !== undefined;
  if (costRelevantChange || data.unitsSold !== undefined) {
    if (costRelevantChange) await recalculateItemCosts(menuItemId);
    await persistClassification(scope);
  }

  // Brain memory (spec T12): only capture SEMANTIC menu changes (name/category/
  // price). Nightly analytics writes (unitsSold, period dates) must NOT create a
  // memory or re-embed. Re-read the row so the memory has the authoritative
  // fields even when the payload only changed one of them.
  const semanticChange =
    data.name !== undefined || data.category !== undefined || data.sellingPrice !== undefined;
  if (semanticChange) {
    const [current] = await db
      .select({ name: menuItem.name, category: menuItem.category, sellingPrice: menuItem.sellingPrice })
      .from(menuItem)
      .where(eq(menuItem.menuItemId, menuItemId))
      .limit(1);
    if (current) {
      void recordOpsEvent({
        userId: scope.userId,
        sourceType: "menu",
        scope: scope.organisationId ? "org" : "user",
        organisationId: scope.organisationId,
        sourceRef: menuItemId,
        title: current.name,
        action: "updated",
        itemName: current.name,
        category: current.category,
        sellingPrice: current.sellingPrice,
      });
    }
  }
}

export async function deleteMenuItem(menuItemId: string, scope: MenuScope) {
  await requireManageableMenuItem(menuItemId, scope);
  try {
    await db.delete(menuItem).where(eq(menuItem.menuItemId, menuItemId));
  } catch (err) {
    // A sale or prep row points at the item and is history: the item stays.
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23503") throw new AppError(409, "CONFLICT", "This menu item has recorded sales or prep history and cannot be deleted");
    throw err;
  }
  await persistClassification(scope);
}

// ---------------------------------------------------------------------------
// Ingredient CRUD
// ---------------------------------------------------------------------------

/**
 * Resolve the unit cost for a menu_item_ingredient row.
 *
 * Cost driver hierarchy (catalog-spine Phase 1, post outside-voice):
 *   1. caller-supplied `unitCost` (manual override per dish — wins)
 *   2. ingredient.preferred_unit_cost (the daily-display cost)
 *   3. ingredient.unit_cost (org-level default)
 *   4. null  → caller decides what to surface (today: stored as "0")
 *
 * The per-location WAC stored on `location_ingredient.weighted_average_cost`
 * is NOT used here — it's reserved for the Menu Intelligence P&L view, not
 * the daily editor. The hybrid was the eng-review tension #1 resolution.
 */
export async function resolveUnitCost(
  callerUnitCost: string | null | undefined,
  ingredientId: string | null | undefined,
): Promise<string> {
  // A POSITIVE caller cost is an explicit manual override — use it as-is.
  // A zero/empty/null cost means "no override" — fall through to the catalog
  // when the row is linked. (Storing 0 must never freeze a linked ingredient
  // at $0 when the catalog has a real price.)
  const callerNum =
    callerUnitCost !== undefined && callerUnitCost !== null && callerUnitCost !== ""
      ? parseFloat(callerUnitCost)
      : NaN;
  if (Number.isFinite(callerNum) && callerNum > 0) {
    return callerUnitCost as string;
  }
  if (!ingredientId) return callerUnitCost && Number.isFinite(callerNum) ? callerUnitCost : "0";
  const [ing] = await db
    .select({
      preferred: ingredient.preferredUnitCost,
      orgDefault: ingredient.unitCost,
    })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, ingredientId));
  if (!ing) return "0";
  return ing.preferred ?? ing.orgDefault ?? "0";
}

/**
 * Compute the line cost for a row.
 *
 * The formula is `storedLineCost` in @culinaire/shared. Quantity is converted
 * to the ingredient's kitchen unit before multiplication. If `ingredientId` is
 * null (legacy free-text row), qty is used as-is and we trust the caller's
 * unit/cost; units with no path between them throw.
 */
async function computeLineCost(
  quantity: string,
  unit: string,
  unitCost: string,
  yieldPct: string,
  ingredientId: string | null | undefined,
): Promise<string> {
  return storedLineCost({ quantity, unitCost, yieldPct }, async (qty) => {
    if (!ingredientId) return qty;
    // Item-aware resolution to the ingredient's KITCHEN unit: handles the
    // content equivalence ("150 ml of a bottle-counted wine" → 0.2 bottle),
    // purchase packaging, per-item conversion rows, and family math. unitCost
    // is per kitchen unit, so the product is the true line cost.
    try {
      const { baseQty } = await resolveToBase(ingredientId, qty, unit);
      return baseQty;
    } catch (err) {
      if (err instanceof IncompatibleUnitsError) {
        // Surface the error: cost would be silently wrong otherwise.
        logger.warn({ ingredientId, unit, err: err.message }, "Unit conversion failed in computeLineCost");
      }
      throw err;
    }
  });
}

export async function addIngredient(menuItemId: string, scope: MenuScope, data: {
  ingredientId?: string | null;
  ingredientName: string;
  note?: string | null;
  quantity: string;
  unit: string;
  unitCost?: string;
  yieldPct?: string;
}) {
  const yieldPct = data.yieldPct ?? "100";
  const resolvedCost = await resolveUnitCost(data.unitCost, data.ingredientId);
  const lineCost = await computeLineCost(
    data.quantity,
    data.unit,
    resolvedCost,
    yieldPct,
    data.ingredientId,
  );

  const [ing] = await db.insert(menuItemIngredient).values({
    menuItemId,
    ingredientId: data.ingredientId ?? null,
    ingredientName: data.ingredientName,
    note: data.note ?? null,
    quantity: data.quantity,
    unit: data.unit,
    unitCost: resolvedCost,
    yieldPct,
    lineCost,
  }).returning();

  // Recalculate item costs
  await recalculateItemCosts(menuItemId);
  await persistClassification(scope);
  return ing;
}

export async function getIngredients(menuItemId: string) {
  return db.select({
    id: menuItemIngredient.id,
    menuItemId: menuItemIngredient.menuItemId,
    ingredientId: menuItemIngredient.ingredientId,
    ingredientName: menuItemIngredient.ingredientName,
    note: menuItemIngredient.note,
    quantity: menuItemIngredient.quantity,
    unit: menuItemIngredient.unit,
    unitCost: menuItemIngredient.unitCost,
    yieldPct: menuItemIngredient.yieldPct,
    lineCost: menuItemIngredient.lineCost,
    costStaleInd: menuItemIngredient.costStaleInd,
    costStaleAt: menuItemIngredient.costStaleAt,
    createdDttm: menuItemIngredient.createdDttm,
    baseUnit: ingredient.baseUnit,
    contentQty: ingredient.contentQty,
    contentUnit: ingredient.contentUnit,
    densityGPerMl: ingredient.densityGPerMl,
    // Purchase packaging (resolver step 2) + provenance age for the recipe editor.
    purchaseUnit: ingredient.purchaseUnit,
    packQty: ingredient.packQty,
    costUpdatedAt: ingredient.updatedDttm,
    // T10 unified cost chain: preferred supplier cost, else org WAC — the same
    // fallback the ingredient picker applies (preferred alone is null for orgs
    // whose costs come from receiving, which froze linked rows at $0).
    catalogUnitCost: sql<string | null>`coalesce(${ingredient.preferredUnitCost}, ${ingredient.unitCost})`,
  }).from(menuItemIngredient)
    .leftJoin(ingredient, eq(menuItemIngredient.ingredientId, ingredient.ingredientId))
    .where(eq(menuItemIngredient.menuItemId, menuItemId))
    .orderBy(menuItemIngredient.ingredientName);
}

export async function deleteIngredient(ingredientId: number, menuItemId: string, scope: MenuScope) {
  await db.delete(menuItemIngredient)
    .where(and(eq(menuItemIngredient.id, ingredientId), eq(menuItemIngredient.menuItemId, menuItemId)));
  await recalculateItemCosts(menuItemId);
  await persistClassification(scope);
}

/**
 * Catalog-spine Phase 3: refresh a menu_item_ingredient row's cost from the
 * linked Catalog ingredient's current preferred_unit_cost. Clears the
 * stale-cost flag set by the DB trigger.
 *
 * Throws if the row is unlinked (legacy free-text) — there's no Catalog
 * cost to refresh from.
 */
export async function refreshIngredientCost(rowId: number, menuItemId: string, scope: MenuScope) {
  const [row] = await db.select().from(menuItemIngredient)
    .where(and(eq(menuItemIngredient.id, rowId), eq(menuItemIngredient.menuItemId, menuItemId)));
  if (!row) throw new Error("Menu item ingredient not found");
  if (!row.ingredientId) {
    throw new Error("Cannot refresh cost on an unlinked row — link to a Catalog ingredient first");
  }

  const [ing] = await db.select({
    preferred: ingredient.preferredUnitCost,
    orgDefault: ingredient.unitCost,
    baseUnit: ingredient.baseUnit,
  }).from(ingredient).where(eq(ingredient.ingredientId, row.ingredientId));

  if (!ing) throw new Error("Linked Catalog ingredient not found");
  const fresh = ing.preferred ?? ing.orgDefault ?? "0";

  const lineCost = await computeLineCost(
    row.quantity,
    row.unit,
    fresh,
    row.yieldPct,
    row.ingredientId,
  );

  const [updated] = await db.update(menuItemIngredient)
    .set({
      unitCost: fresh,
      lineCost,
      costStaleInd: false,
      costStaleAt: null,
    })
    .where(and(eq(menuItemIngredient.id, rowId), eq(menuItemIngredient.menuItemId, menuItemId)))
    .returning();

  await recalculateItemCosts(menuItemId);
  await persistClassification(scope);
  return updated;
}

/**
 * Catalog-spine Phase 3: P&L view food cost computed from per-location WAC
 * instead of preferred-supplier cost. Used by Menu Intelligence reporting,
 * not the daily editor.
 *
 * For each linked menu_item_ingredient row:
 *   - Look up location_ingredient.weighted_average_cost for the menu item's
 *     store_location_id.
 *   - If WAC is null (no receiving history at that location), fall back to
 *     the row's stored unit_cost (the daily-display value).
 *   - Convert quantity to base unit, apply yield_pct, sum across rows.
 *
 * Returns the total P&L food cost. Daily food cost on `menu_item.food_cost`
 * is unaffected.
 */
export async function getPandLFoodCost(menuItemId: string): Promise<number> {
  const [item] = await db.select({
    storeLocationId: menuItem.storeLocationId,
    servings: menuItem.servings,
    qFactorPct: menuItem.qFactorPct,
  }).from(menuItem).where(eq(menuItem.menuItemId, menuItemId));
  if (!item) throw new Error("Menu item not found");
  if (!item.storeLocationId) {
    const [m] = await db.select({ foodCost: menuItem.foodCost })
      .from(menuItem).where(eq(menuItem.menuItemId, menuItemId));
    return Number(m?.foodCost ?? 0);
  }

  const ingredients = await db.select({
    quantity: menuItemIngredient.quantity,
    unit: menuItemIngredient.unit,
    unitCost: menuItemIngredient.unitCost,
    yieldPct: menuItemIngredient.yieldPct,
    ingredientId: menuItemIngredient.ingredientId,
  }).from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId));

  let total = 0;
  for (const r of ingredients) {
    if (!r.ingredientId) {
      // Unlinked row — use the stored unit_cost (chef's manual value).
      total += await lineCostFor(r.quantity, r.unit, r.unitCost, r.yieldPct, null);
      continue;
    }

    // Look up location WAC for this (location, ingredient) pair.
    const [li] = await db.select({
      wac: locationIngredient.weightedAverageCost,
    }).from(locationIngredient)
      .where(
        and(
          eq(locationIngredient.storeLocationId, item.storeLocationId),
          eq(locationIngredient.ingredientId, r.ingredientId),
        ),
      );

    const cost = li?.wac ?? r.unitCost;
    total += await lineCostFor(r.quantity, r.unit, cost, r.yieldPct, r.ingredientId);
  }
  return plateFoodCost(total, item.servings, item.qFactorPct);
}

/** Internal helper: compute a single line cost as a number (vs. computeLineCost which returns string). */
async function lineCostFor(
  quantity: string,
  unit: string,
  unitCost: string,
  yieldPct: string,
  ingredientId: string | null,
): Promise<number> {
  const s = await computeLineCost(quantity, unit, unitCost, yieldPct, ingredientId);
  return parseFloat(s);
}

// ---------------------------------------------------------------------------
// Cost Calculation
// ---------------------------------------------------------------------------

async function recalculateItemCosts(menuItemId: string) {
  const ingredients = await db.select().from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId));

  const [item] = await db.select({
    sellingPrice: menuItem.sellingPrice,
    servings: menuItem.servings,
    servingsPerSale: menuItem.servingsPerSale,
    qFactorPct: menuItem.qFactorPct,
  }).from(menuItem).where(eq(menuItem.menuItemId, menuItemId)).limit(1);

  if (!item) return;

  const costs = storedItemCosts({
    lineCosts: ingredients.map((ing) => ing.lineCost),
    servings: item.servings,
    servingsPerSale: item.servingsPerSale,
    qFactorPct: item.qFactorPct,
    sellingPrice: item.sellingPrice,
  });

  await db.update(menuItem).set({
    ...costs,
    updatedDttm: new Date(),
  }).where(eq(menuItem.menuItemId, menuItemId));
}

// ---------------------------------------------------------------------------
// Classification Engine
// ---------------------------------------------------------------------------

type MenuItemRow = typeof menuItem.$inferSelect;

/**
 * Menu mix and Star/Plowhorse/Puzzle/Dog for a set of items, relative to that set (pure: nothing is written).
 * Mix is each item's share of the set's units sold; the averages of contribution margin and mix split the matrix.
 */
export function classifyMenu(items: MenuItemRow[]): Map<string, { menuMixPct: string; classification: string }> {
  const out = new Map<string, { menuMixPct: string; classification: string }>();
  if (items.length === 0) return out;
  const totalUnitsSold = items.reduce((sum, i) => sum + i.unitsSold, 0);

  // Averages use the stored mix text (two decimals), exactly as when the values were persisted before classifying.
  const mixes = items.map((i) => menuMixPct(i.unitsSold, totalUnitsSold).toFixed(2));
  const { classifications } = classifyAgainstWholeMenu(items.map((item, i) => ({
    unitsSold: item.unitsSold,
    contributionMargin: parseFloat(item.contributionMargin ?? "0"),
    menuMixPct: parseFloat(mixes[i]),
  })));

  for (const [i, item] of items.entries()) {
    out.set(item.menuItemId, { menuMixPct: mixes[i], classification: classifications[i] });
  }
  return out;
}

/**
 * Store mix and classification for the caller's whole menu, relative to the whole menu. Only rows whose values
 * changed are written. Always the whole menu: a category-relative value stored on an item would be read by prep
 * and the item list as if it were the menu-wide one.
 */
export async function persistClassification(scope: MenuScope): Promise<void> {
  const items = await getMenuItems(scope);
  const computed = classifyMenu(items);
  for (const item of items) {
    const next = computed.get(item.menuItemId)!;
    if (item.menuMixPct === next.menuMixPct && item.classification === next.classification) continue;
    await db.update(menuItem).set({ menuMixPct: next.menuMixPct, classification: next.classification, updatedDttm: new Date() })
      .where(eq(menuItem.menuItemId, item.menuItemId));
  }
}

/** POST /analysis/recalculate: refresh stored costs (of one category, or all), then stored mix and classification. */
export async function recalculateMenu(scope: MenuScope, category?: string) {
  const items = await getMenuItems(scope, category);
  if (items.length === 0) return;

  for (const item of items) {
    await recalculateItemCosts(item.menuItemId);
  }
  await persistClassification(scope);

  logger.info({ userId: scope.userId, itemCount: items.length }, "Menu recalculated");
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** GET /analysis: computed from what is stored, writes nothing. With `category`, mix and classification are relative to that category only. */
export async function getMenuAnalysis(scope: MenuScope, category?: string) {
  const stored = await getMenuItems(scope, category);
  const computed = classifyMenu(stored);
  const items = stored.map((i) => ({ ...i, ...computed.get(i.menuItemId)! }));

  const analysed = items.map((i) => ({
    ...i,
    sellingPrice: parseFloat(i.sellingPrice),
    foodCost: parseFloat(i.foodCost ?? "0"),
    foodCostPct: parseFloat(i.foodCostPct ?? "0"),
    contributionMargin: parseFloat(i.contributionMargin ?? "0"),
    menuMixPct: parseFloat(i.menuMixPct ?? "0"),
  }));

  return {
    ...summariseMenuAnalysis(analysed),
    items: analysed,
  };
}

// ---------------------------------------------------------------------------
// Category Settings
// ---------------------------------------------------------------------------

// Category targets are still per user (the table has no organisation column); sharing them across the organisation is a follow-up.
export async function getCategorySettings(scope: MenuScope) {
  return db.select().from(menuCategorySetting)
    .where(eq(menuCategorySetting.userId, scope.userId))
    .orderBy(menuCategorySetting.categoryName);
}

export async function upsertCategorySetting(scope: MenuScope, categoryName: string, targetFoodCostPct: string) {
  const userId = scope.userId;
  const [existing] = await db.select().from(menuCategorySetting)
    .where(and(eq(menuCategorySetting.userId, userId), eq(menuCategorySetting.categoryName, categoryName)))
    .limit(1);

  if (existing) {
    await db.update(menuCategorySetting).set({
      targetFoodCostPct,
      updatedDttm: new Date(),
    }).where(eq(menuCategorySetting.id, existing.id));
  } else {
    await db.insert(menuCategorySetting).values({
      userId,
      categoryName,
      targetFoodCostPct,
    });
  }
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------

export async function importCsvSalesData(scope: MenuScope, csvContent: string) {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { updated: 0, notFound: [] };

  const header = lines[0].toLowerCase();
  const nameIdx = header.split(",").findIndex((h) => h.trim().includes("name") || h.trim().includes("item"));
  const soldIdx = header.split(",").findIndex((h) => h.trim().includes("sold") || h.trim().includes("quantity") || h.trim().includes("units"));

  if (nameIdx === -1 || soldIdx === -1) {
    throw new Error("CSV must have columns for item name and units sold");
  }

  let updated = 0;
  // Names with no item to update: no match, or (marked as such) more than one.
  const notFound: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cols[nameIdx];
    const sold = parseInt(cols[soldIdx], 10);
    if (!name || isNaN(sold)) continue;

    // Find matching menu item by name (case-insensitive), among the dishes this caller may change: this overwrites units sold.
    const [match, another] = await db.select({ menuItemId: menuItem.menuItemId })
      .from(menuItem)
      .where(and(menuReadable(scope), scope.isOrgAdmin ? undefined : eq(menuItem.userId, scope.userId), isNull(menuItem.linkedIngredientId), sql`LOWER(${menuItem.name}) = LOWER(${name})`))
      .limit(2);

    if (another) {
      notFound.push(`${name} (ambiguous name: multiple menu items)`);
    } else if (match) {
      await db.update(menuItem).set({ unitsSold: sold, updatedDttm: new Date() })
        .where(eq(menuItem.menuItemId, match.menuItemId));
      updated++;
    } else {
      notFound.push(name);
    }
  }

  // Recalculate after import
  await recalculateMenu(scope);

  return { updated, notFound };
}

// ---------------------------------------------------------------------------
// AI Recommendations
// ---------------------------------------------------------------------------

import { z } from "zod";
import { generateStructured } from "./aiService.js";
import { buildContextString } from "./userContextService.js";

const RecommendationSchema = z.object({
  summary: z.string().describe("One-sentence assessment of this item's performance"),
  actions: z.array(z.object({
    type: z.enum(["protect", "swap_ingredient", "adjust_portion", "raise_price", "lower_price", "rename", "rewrite_description", "promote", "remove", "generate_replacement"]),
    description: z.string().describe("Clear, actionable recommendation for a chef (not tech-savvy)"),
    impact: z.string().optional().describe("Projected financial impact if applicable"),
  })).describe("2-4 specific, actionable recommendations"),
  menuDescription: z.string().optional().describe("Rewritten menu description if applicable (using restaurant voice)"),
});

export type MenuRecommendation = z.infer<typeof RecommendationSchema>;

export async function getItemRecommendations(menuItemId: string, scope: MenuScope): Promise<MenuRecommendation> {
  const item = await requireMenuItem(menuItemId, scope);

  const ingredients = await getIngredients(menuItemId);
  const kitchenContext = await buildContextString(scope.userId);

  const ingredientList = ingredients.map((i) =>
    `${i.ingredientName}: ${i.quantity} ${i.unit} @ $${i.unitCost}/${i.unit} (line cost: $${i.lineCost})`
  ).join("\n");

  const prompt = `You are a menu engineering consultant for a restaurant. Analyse this menu item and provide specific, actionable recommendations.

${kitchenContext}

## Menu Item Analysis
- Name: ${item.name}
- Category: ${item.category}
- Selling Price: $${item.sellingPrice}
- Food Cost: $${item.foodCost ?? "0"}
- Food Cost %: ${item.foodCostPct ?? "0"}%
- Contribution Margin: $${item.contributionMargin ?? "0"}
- Units Sold (period): ${item.unitsSold}
- Menu Mix: ${item.menuMixPct ?? "0"}%
- Classification: ${item.classification.toUpperCase()}

## Ingredients
${ingredientList || "No ingredients entered yet"}

## Classification Guide
- STAR: High profit + high popularity. Protect it.
- PLOWHORSE: Low profit + high popularity. Reduce cost or raise price.
- PUZZLE: High profit + low popularity. Better marketing or lower price to drive trial.
- DOG: Low profit + low popularity. Rework or replace.

Provide recommendations appropriate for this item's classification. Be specific about dollar amounts, ingredient swaps, and projected impact. Write for a chef, not an accountant.`;

  return generateStructured({ schema: RecommendationSchema, prompt });
}

// ---------------------------------------------------------------------------
// Waste Impact for Menu Items
// ---------------------------------------------------------------------------

export interface WasteImpactResult {
  menuItemId: string;
  wasteEstimate: number;
}

/**
 * For each menu item, check if any of its ingredients appear in waste logs
 * from the last 30 days. Returns aggregated waste cost per menu item. The waste
 * is the viewer's own plus the organisation's at the locations the viewer may use.
 */
export async function getWasteImpactForMenuItems(scope: MenuScope, actor: TokenPayload): Promise<WasteImpactResult[]> {
  const items = await getMenuItems(scope);
  if (items.length === 0) return [];

  // Get all ingredients for all menu items.
  // Use Drizzle's `inArray` rather than raw `= ANY(${jsArray})` — the raw
  // form serialises a single-element JS array as just the inner string,
  // which Postgres reads as a malformed uuid[] literal and 500s.
  const allItemIds = items.map((i) => i.menuItemId);
  const allIngredients = await db.select().from(menuItemIngredient)
    .where(inArray(menuItemIngredient.menuItemId, allItemIds));

  if (allIngredients.length === 0) return [];

  let wasteInScope = eq(wasteLog.userId, scope.userId);
  if (scope.organisationId !== null) {
    const locationIds = await accessibleLocationIds(actor);
    if (locationIds.length) wasteInScope = or(wasteInScope, and(eq(wasteLog.organisationId, scope.organisationId), inArray(wasteLog.storeLocationId, locationIds)))!;
  }

  // Query waste logs for matching ingredients in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const wasteData = await db
    .select({
      ingredientName: sql<string>`LOWER(${wasteLog.ingredientName})`,
      totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
    })
    .from(wasteLog)
    .where(
      and(
        wasteInScope,
        gte(wasteLog.loggedAt, thirtyDaysAgo),
      ),
    )
    .groupBy(sql`LOWER(${wasteLog.ingredientName})`);

  // Build a cost map: lowercase ingredient name -> total waste cost
  const wasteCostMap = new Map<string, number>();
  for (const w of wasteData) {
    wasteCostMap.set(w.ingredientName, Number(w.totalCost));
  }

  // For each menu item, sum up waste costs of its ingredients
  const results: WasteImpactResult[] = [];

  // Group ingredients by menu item
  const ingredientsByItem = new Map<string, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingredientsByItem.get(ing.menuItemId) ?? [];
    list.push(ing);
    ingredientsByItem.set(ing.menuItemId, list);
  }

  for (const item of items) {
    const itemIngs = ingredientsByItem.get(item.menuItemId) ?? [];
    let wasteEstimate = 0;
    for (const ing of itemIngs) {
      const cost = wasteCostMap.get(ing.ingredientName.toLowerCase());
      if (cost && cost > 0) wasteEstimate += cost;
    }
    if (wasteEstimate > 0) {
      results.push({ menuItemId: item.menuItemId, wasteEstimate });
    }
  }

  return results;
}

export function generateReplacementContext(item: {
  name: string;
  category: string;
  foodCostPct: string | null;
  contributionMargin: string | null;
  unitsSold: number;
  classification: string;
}) {
  return {
    request: `Generate a replacement recipe for "${item.name}" in the ${item.category} category. This item was classified as a ${item.classification} with food cost of ${item.foodCostPct ?? "unknown"}% and contribution margin of $${item.contributionMargin ?? "unknown"}. The replacement should target Star territory — high profitability and broad appeal.`,
    domain: "recipe" as const,
  };
}
