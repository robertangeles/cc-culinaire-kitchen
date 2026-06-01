/**
 * @module services/prepService
 *
 * Domain logic for the Kitchen Operations Copilot Lite module.
 * Menu-driven approach: chefs select which dishes they're prepping,
 * then tasks are generated from those selections only.
 */

import pino from "pino";
import { db } from "../db/index.js";
import {
  prepSession,
  prepTask,
  ingredientCrossUsage,
  prepMenuSelection,
  recipe,
  menuItem,
  menuItemIngredient,
  ingredient,
  stockLevel,
  consumptionLog,
  user,
} from "../db/schema.js";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { getUserOrgContext } from "./orgContextService.js";
import { computeSuggestedSelections, aggregatePrepLines, attachOnHand, type PrepSourceLine } from "./prepMath.js";
import { convertUnit as sharedConvertUnit, normalizeUnit, type BaseUnit } from "@culinaire/shared";
import { addStock, deductStock } from "./stockService.js";

const logger = pino({ name: "prepService" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepSessionRow {
  prepSessionId: string;
  userId: number;
  prepDate: string;
  expectedCovers: number | null;
  actualCovers: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  tasksSkipped: number;
  notes: string | null;
  isEnded: boolean;
  createdDttm: string;
  updatedDttm: string;
}

export interface PrepTaskRow {
  prepTaskId: string;
  prepSessionId: string;
  menuItemId: string | null;
  recipeId: string | null;
  taskDescription: string;
  ingredientName: string;
  quantityNeeded: number;
  unit: string;
  prepTimeMinutes: number | null;
  priorityScore: number;
  priorityTier: string;
  ingredientId: string | null;
  station: string | null;
  onHandQty: number | null;
  prepNeeded: number | null;
  useBy: string | null;
  isOverPrep: boolean;
  status: string;
  assignedTo: string | null;
  completedAt: string | null;
  createdDttm: string;
}

export interface CrossUsageRow {
  crossUsageId: string;
  ingredientName: string;
  dishCount: number;
  totalQuantity: number;
  unit: string;
  dishNames: string[];
}

export interface HighImpactDish {
  recipeId: string;
  menuItemId: string | null;
  title: string;
  ingredientCount: number;
  totalPrepMinutes: number;
  complexityScore: number;
  classification: string | null;
}

export interface HighImpactResult {
  dishes: HighImpactDish[];
  hasMenuItems: boolean;
}

export interface MenuSelectionInput {
  recipeId?: string;
  menuItemId?: string;
  dishName: string;
  expectedPortions: number;
  category?: string;
}

export interface MenuSelectionRow {
  selectionId: string;
  prepSessionId: string;
  recipeId: string | null;
  menuItemId: string | null;
  dishName: string;
  expectedPortions: number;
  category: string | null;
  createdDttm: string;
}

export interface MenuForSelection {
  menuItems: Array<{
    menuItemId: string;
    name: string;
    category: string;
    classification: string;
    foodCostPct: number | null;
    sellingPrice: number;
  }>;
  recipes: Array<{
    recipeId: string;
    title: string;
    domain: string;
    yield: string | null;
  }>;
  hasMenuItems: boolean;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse human-readable time strings into minutes.
 * Handles: "15 mins", "1 hour 30 mins", "45 minutes", "1h 30m", "2 hours"
 */
function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const s = timeStr.toLowerCase().trim();

  let totalMinutes = 0;

  // Match hours: "1 hour", "2 hours", "1h"
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/);
  if (hourMatch) totalMinutes += parseFloat(hourMatch[1]) * 60;

  // Match minutes: "30 mins", "45 minutes", "30m"
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m(?!\w))/);
  if (minMatch) totalMinutes += parseFloat(minMatch[1]);

  // If no matches, try plain number (assume minutes)
  if (totalMinutes === 0) {
    const plain = parseFloat(s);
    if (!isNaN(plain)) totalMinutes = plain;
  }

  return Math.round(totalMinutes);
}

/**
 * Parse yield/serving strings into a number.
 * Handles: "Serves 4", "Makes 12", "4 servings", "6", "Yields 8"
 */
function parseYieldToServings(yieldStr: string): number {
  if (!yieldStr) return 4;
  const match = yieldStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Parse ingredient amount strings into numbers.
 * Handles: "2", "1.5", "1/2", "1 1/2", "3/4"
 */
function parseAmountToNumber(amount: string): number {
  if (!amount) return 0;
  const s = amount.trim();

  // Mixed fraction: "1 1/2"
  const mixedMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1], 10) + parseInt(mixedMatch[2], 10) / parseInt(mixedMatch[3], 10);
  }

  // Simple fraction: "1/2", "3/4"
  const fracMatch = s.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    return parseInt(fracMatch[1], 10) / parseInt(fracMatch[2], 10);
  }

  // Decimal or integer
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// createPrepSession — creates session WITHOUT auto-generating tasks
// ---------------------------------------------------------------------------

export async function createPrepSession(
  userId: number,
  prepDate: string,
  expectedCovers?: number,
): Promise<{ session: PrepSessionRow }> {
  const orgCtx = await getUserOrgContext(userId);

  // Resolve the user's selected location so stock lookups work.
  const [userRow] = await db
    .select({ selectedLocationId: user.selectedLocationId })
    .from(user)
    .where(eq(user.userId, userId));

  const [row] = await db
    .insert(prepSession)
    .values({
      userId,
      organisationId: orgCtx.primaryOrgId,
      storeLocationId: userRow?.selectedLocationId ?? null,
      prepDate,
      expectedCovers: expectedCovers ?? null,
    })
    .returning();

  logger.info(
    { prepSessionId: row.prepSessionId, userId, prepDate },
    "Prep session created (menu-driven, no auto-generation)",
  );

  return { session: toSessionRow(row) };
}

// ---------------------------------------------------------------------------
// getMenuForSelection — returns dishes available for the chef to pick
// ---------------------------------------------------------------------------

export async function getMenuForSelection(
  userId: number,
  teamView?: boolean,
): Promise<MenuForSelection> {
  // Determine user scope
  let userIds: number[];
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userIds = orgCtx.orgIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
  } else {
    userIds = [userId];
  }

  // Load menu items
  const menuItems = await db
    .select()
    .from(menuItem)
    .where(inArray(menuItem.userId, userIds));

  // Load active recipes
  const recipes = await db
    .select()
    .from(recipe)
    .where(and(inArray(recipe.userId, userIds), eq(recipe.archivedInd, false)));

  return {
    menuItems: menuItems.map((mi) => ({
      menuItemId: mi.menuItemId,
      name: mi.name,
      category: mi.category,
      classification: mi.classification,
      foodCostPct: mi.foodCostPct ? Number(mi.foodCostPct) : null,
      sellingPrice: Number(mi.sellingPrice),
    })),
    recipes: recipes.map((r) => {
      const data = r.recipeData as Record<string, unknown>;
      return {
        recipeId: r.recipeId,
        title: r.title,
        domain: r.domain,
        yield: (data.yield as string) || null,
      };
    }),
    hasMenuItems: menuItems.length > 0,
  };
}

// ---------------------------------------------------------------------------
// suggestSelections — forecast covers → suggested per-item portion counts
// ---------------------------------------------------------------------------

export interface ForecastSuggestion {
  menuItemId: string;
  name: string;
  category: string | null;
  unitsSold: number;
  suggestedPortions: number;
  basis: "historical" | "estimated";
}

export interface ForecastSuggestResult {
  covers: number;
  hasMenuItems: boolean;
  /** True when at least one selectable item has sales history (mix is real, not 1/N). */
  anyHistory: boolean;
  suggestions: ForecastSuggestion[];
}

/**
 * Suggest per-item portion counts for a forecast cover count. Tenant-scoped to
 * the user (or their org members under teamView), mirroring getMenuForSelection.
 * The math lives in the pure prepMath.computeSuggestedSelections.
 */
export async function suggestSelections(
  userId: number,
  covers: number,
  teamView?: boolean,
  buffer?: number,
): Promise<ForecastSuggestResult> {
  let userIds: number[];
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userIds = orgCtx.orgIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
  } else {
    userIds = [userId];
  }

  const rows = await db
    .select({
      menuItemId: menuItem.menuItemId,
      name: menuItem.name,
      category: menuItem.category,
      unitsSold: menuItem.unitsSold,
    })
    .from(menuItem)
    .where(inArray(menuItem.userId, userIds));

  const items = rows.map((r) => ({
    menuItemId: r.menuItemId,
    category: r.category,
    unitsSold: Number(r.unitsSold) || 0,
  }));

  const byId = new Map(computeSuggestedSelections(covers, items, { buffer }).map((s) => [s.menuItemId, s]));

  return {
    covers,
    hasMenuItems: rows.length > 0,
    anyHistory: items.some((i) => i.unitsSold > 0),
    suggestions: rows.map((r) => {
      const s = byId.get(r.menuItemId);
      return {
        menuItemId: r.menuItemId,
        name: r.name,
        category: r.category,
        unitsSold: Number(r.unitsSold) || 0,
        suggestedPortions: s?.suggestedPortions ?? 0,
        basis: s?.basis ?? ("estimated" as const),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// saveMenuSelections — persist the chef's dish picks for a session
// ---------------------------------------------------------------------------

export async function saveMenuSelections(
  sessionId: string,
  userId: number,
  selections: MenuSelectionInput[],
): Promise<MenuSelectionRow[]> {
  // Verify session ownership
  const [session] = await db
    .select()
    .from(prepSession)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)));

  if (!session) {
    throw new Error("Prep session not found or not yours");
  }
  if (session.isEndedInd) {
    throw new Error("Cannot modify an ended prep session");
  }

  const rows = await db.transaction(async (tx) => {
    await tx
      .delete(prepMenuSelection)
      .where(eq(prepMenuSelection.prepSessionId, sessionId));

    if (selections.length === 0) return [];

    return tx
      .insert(prepMenuSelection)
      .values(
        selections.map((s) => ({
          prepSessionId: sessionId,
          recipeId: s.recipeId ?? null,
          menuItemId: s.menuItemId ?? null,
          dishName: s.dishName,
          expectedPortions: s.expectedPortions,
          category: s.category ?? null,
        })),
      )
      .returning();
  });

  logger.info(
    { sessionId, selectionCount: rows.length },
    "Menu selections saved",
  );

  return rows.map(toSelectionRow);
}

// ---------------------------------------------------------------------------
// getSelections — get selections for a session
// ---------------------------------------------------------------------------

export async function getSelections(
  sessionId: string,
  userId: number,
  teamView?: boolean,
): Promise<MenuSelectionRow[]> {
  // Verify session access
  let ownerFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    ownerFilter = orgCtx.orgIds.length > 0
      ? and(eq(prepSession.prepSessionId, sessionId), inArray(prepSession.userId, orgCtx.orgMemberUserIds))
      : and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId));
  } else {
    ownerFilter = and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId));
  }

  const [session] = await db.select().from(prepSession).where(ownerFilter);
  if (!session) return [];

  const rows = await db
    .select()
    .from(prepMenuSelection)
    .where(eq(prepMenuSelection.prepSessionId, sessionId));

  return rows.map(toSelectionRow);
}

// ---------------------------------------------------------------------------
// generateTasksFromSelections — THE KEY FUNCTION
// ---------------------------------------------------------------------------

export async function generateTasksFromSelections(
  sessionId: string,
  userId: number,
): Promise<PrepTaskRow[]> {
  // Verify session ownership
  const [session] = await db
    .select()
    .from(prepSession)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)));

  if (!session) {
    throw new Error("Prep session not found or not yours");
  }
  if (session.isEndedInd) {
    throw new Error("Cannot modify an ended prep session");
  }

  // Read selections (the clears + re-inserts happen atomically in the txn below)
  const selections = await db
    .select()
    .from(prepMenuSelection)
    .where(eq(prepMenuSelection.prepSessionId, sessionId));

  // Classification weights for priority scoring
  const classificationWeights: Record<string, number> = {
    star: 4,
    plowhorse: 3,
    puzzle: 2,
    dog: 1,
    unclassified: 2,
  };

  // --- Batch loads (no per-dish N+1) ---
  const menuItemIds = selections.map((s) => s.menuItemId).filter((id): id is string => id !== null);
  const recipeIds = selections.map((s) => s.recipeId).filter((id): id is string => id !== null);

  const menuItemsMap = new Map<string, typeof menuItem.$inferSelect>();
  if (menuItemIds.length > 0) {
    const mis = await db.select().from(menuItem).where(inArray(menuItem.menuItemId, menuItemIds));
    for (const mi of mis) menuItemsMap.set(mi.menuItemId, mi);
  }

  const recipesMap = new Map<string, typeof recipe.$inferSelect>();
  if (recipeIds.length > 0) {
    const recs = await db.select().from(recipe).where(inArray(recipe.recipeId, recipeIds));
    for (const r of recs) recipesMap.set(r.recipeId, r);
  }

  // All menu_item_ingredient rows for the selected dishes — ONE query (kills the
  // previous per-dish N+1, which the one-level component expansion would amplify).
  const miIngredientsByItem = new Map<string, (typeof menuItemIngredient.$inferSelect)[]>();
  if (menuItemIds.length > 0) {
    const rows = await db
      .select()
      .from(menuItemIngredient)
      .where(inArray(menuItemIngredient.menuItemId, menuItemIds));
    for (const row of rows) {
      const list = miIngredientsByItem.get(row.menuItemId);
      if (list) list.push(row);
      else miIngredientsByItem.set(row.menuItemId, [row]);
    }
  }

  // Catalog categories (→ station) for those ingredients — ONE query.
  const ingredientIds = [
    ...new Set(
      [...miIngredientsByItem.values()]
        .flat()
        .map((r) => r.ingredientId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const categoryById = new Map<string, string | null>();
  if (ingredientIds.length > 0) {
    const cats = await db
      .select({ id: ingredient.ingredientId, category: ingredient.ingredientCategory })
      .from(ingredient)
      .where(inArray(ingredient.ingredientId, ingredientIds));
    for (const c of cats) categoryById.set(c.id, c.category);
  }

  // Name-based category lookup for recipe-path ingredients (P1-5: recipe station assignment).
  // Loads the full catalog, builds a lowercased name → category map so recipe
  // ingredients like "Parsley" inherit the catalog station instead of "Other."
  const categoryByName = new Map<string, string>();
  if (recipeIds.length > 0) {
    const allCats = await db
      .select({ name: ingredient.ingredientName, category: ingredient.ingredientCategory })
      .from(ingredient);
    for (const c of allCats) categoryByName.set(c.name.toLowerCase().trim(), c.category);
  }

  // Build source ingredient lines across all selected dishes, then aggregate.
  const sourceLines: PrepSourceLine[] = [];

  for (const sel of selections) {
    const portionsNeeded = sel.expectedPortions;

    if (sel.menuItemId && menuItemsMap.has(sel.menuItemId)) {
      // Menu-item path: per-BATCH quantities from menu_item_ingredient.
      const mi = menuItemsMap.get(sel.menuItemId)!;
      const weight = classificationWeights[mi.classification ?? "unclassified"] ?? 2;
      const servings = mi.servings ?? 1;

      for (const ing of miIngredientsByItem.get(sel.menuItemId) ?? []) {
        sourceLines.push({
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName,
          unit: ing.unit,
          category: ing.ingredientId ? categoryById.get(ing.ingredientId) ?? null : null,
          quantity: Number(ing.quantity),
          yieldPct: Number(ing.yieldPct) || 100,
          servings,
          expectedPortions: portionsNeeded,
          dishName: sel.dishName,
          menuItemId: sel.menuItemId,
          recipeId: null,
          classificationWeight: weight,
          prepTimeMinutes: 0,
        });
      }
    } else if (sel.recipeId && recipesMap.has(sel.recipeId)) {
      // Recipe path: free-text ingredients from recipe.recipeData JSONB.
      const r = recipesMap.get(sel.recipeId)!;
      const data = r.recipeData as Record<string, unknown>;
      const ingredients = data.ingredients as Array<{
        amount?: string;
        unit?: string;
        name?: string;
      }> | undefined;
      if (!ingredients || !Array.isArray(ingredients)) continue;

      const recipeYield = parseYieldToServings((data.yield as string) || "");
      const totalTime =
        parseTimeToMinutes((data.prepTime as string) || "") +
        parseTimeToMinutes((data.cookTime as string) || "");
      const matchedMi = [...menuItemsMap.values()].find(
        (mi) => mi.name.toLowerCase() === r.title.toLowerCase(),
      );
      const weight = classificationWeights[matchedMi?.classification ?? "unclassified"] ?? 2;

      for (const ing of ingredients) {
        if (!ing.name) continue;
        const matchedCategory = categoryByName.get(ing.name.toLowerCase().trim()) ?? null;
        sourceLines.push({
          ingredientId: null,
          ingredientName: ing.name,
          unit: ing.unit || "ea",
          category: matchedCategory,
          quantity: parseAmountToNumber(ing.amount ?? "0"),
          yieldPct: 100,
          // The recipe's yield IS its "servings" — the scaling divides by it.
          servings: recipeYield || 4,
          expectedPortions: portionsNeeded,
          dishName: sel.dishName,
          menuItemId: matchedMi?.menuItemId ?? null,
          recipeId: sel.recipeId,
          classificationWeight: weight,
          prepTimeMinutes: totalTime,
        });
      }
    }
  }

  const rawAggregated = aggregatePrepLines(sourceLines);

  // Attach on-hand stock from stock_level (P1-1: forecast - on_hand = prep_needed).
  const catalogIds = [...new Set(rawAggregated.map((l) => l.ingredientId).filter((id): id is string => id !== null))];
  const stockByIngredientId = new Map<string, { qty: number; baseUnit: string }>();
  if (catalogIds.length > 0 && session.storeLocationId) {
    const stockRows = await db
      .select({
        ingredientId: stockLevel.ingredientId,
        currentQty: stockLevel.currentQty,
        baseUnit: ingredient.baseUnit,
      })
      .from(stockLevel)
      .innerJoin(ingredient, eq(ingredient.ingredientId, stockLevel.ingredientId))
      .where(
        and(
          eq(stockLevel.storeLocationId, session.storeLocationId),
          inArray(stockLevel.ingredientId, catalogIds),
        ),
      );
    for (const sr of stockRows) {
      stockByIngredientId.set(sr.ingredientId, { qty: Number(sr.currentQty), baseUnit: sr.baseUnit });
    }
  }

  const safeConvert = (qty: number, from: string, to: string): number | null => {
    const nFrom = normalizeUnit(from);
    const nTo = normalizeUnit(to);
    if (!nFrom || !nTo) return null;
    try { return sharedConvertUnit(qty, nFrom, nTo); }
    catch { return null; }
  };

  const aggregated = attachOnHand(rawAggregated, stockByIngredientId, safeConvert);

  // Priority score + tiers: cross-usage count × prep-time weight × menu class.
  const scored = aggregated
    .map((line) => ({
      line,
      priorityScore:
        line.dishes.length * (line.prepTimeMinutes / 10 + 1) * line.classificationWeight,
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const total = scored.length;
  const topCutoff = Math.ceil(total * 0.3);
  const midCutoff = Math.ceil(total * 0.7);

  // Persist atomically: clearing + re-inserting a session's tasks must never be
  // observable half-written, and a mid-write failure must roll back cleanly.
  const taskRows: PrepTaskRow[] = await db.transaction(async (tx) => {
    await tx.delete(prepTask).where(eq(prepTask.prepSessionId, sessionId));
    await tx.delete(ingredientCrossUsage).where(eq(ingredientCrossUsage.prepSessionId, sessionId));

    const rows: PrepTaskRow[] = [];
    for (let i = 0; i < scored.length; i++) {
      const { line, priorityScore } = scored[i];
      const tier = i < topCutoff ? "start_first" : i < midCutoff ? "then_these" : "can_wait";
      const [row] = await tx
        .insert(prepTask)
        .values({
          prepSessionId: sessionId,
          userId,
          menuItemId: line.menuItemIds[0] ?? null,
          recipeId: line.recipeIds[0] ?? null,
          ingredientId: line.ingredientId,
          taskDescription: `Prep ${line.ingredientName} for ${line.dishes.join(", ")}`,
          ingredientName: line.ingredientName,
          quantityNeeded: String(Math.round(line.totalQuantity * 1000) / 1000),
          unit: line.unit,
          prepTimeMinutes: line.prepTimeMinutes > 0 ? line.prepTimeMinutes : null,
          priorityScore: String(Math.round(priorityScore * 100) / 100),
          priorityTier: tier,
          station: line.station,
          onHandQty: line.onHandQty != null ? String(line.onHandQty) : null,
          prepNeeded: line.prepNeeded != null ? String(line.prepNeeded) : null,
        })
        .returning();
      rows.push(toTaskRow(row));
    }

    // Cross-usage: ingredients shared by 2+ dishes, keyed by catalog id so
    // "Tomato Sauce" / "tomato sauce" collapse to ONE batch number.
    for (const line of aggregated) {
      if (line.dishes.length < 2) continue;
      await tx.insert(ingredientCrossUsage).values({
        userId,
        prepSessionId: sessionId,
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        dishCount: line.dishes.length,
        totalQuantity: String(Math.round(line.totalQuantity * 1000) / 1000),
        unit: line.unit,
        dishNames: line.dishes,
      });
    }

    await tx
      .update(prepSession)
      .set({ tasksTotal: rows.length, updatedDttm: new Date() })
      .where(eq(prepSession.prepSessionId, sessionId));

    return rows;
  });

  logger.info(
    { sessionId, taskCount: taskRows.length, selectionCount: selections.length },
    "Prep tasks generated from menu selections",
  );

  return taskRows;
}

// ---------------------------------------------------------------------------
// getPreviousSelections — get most recent session's selections for quick re-use
// ---------------------------------------------------------------------------

export async function getPreviousSelections(
  userId: number,
  teamView?: boolean,
): Promise<MenuSelectionRow[]> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgIds.length > 0
      ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
      : eq(prepSession.userId, userId);
  } else {
    userFilter = eq(prepSession.userId, userId);
  }

  // Find the most recent session that has selections
  const recentSessions = await db
    .select({ prepSessionId: prepSession.prepSessionId })
    .from(prepSession)
    .where(userFilter)
    .orderBy(desc(prepSession.prepDate), desc(prepSession.createdDttm))
    .limit(5);

  for (const s of recentSessions) {
    const selections = await db
      .select()
      .from(prepMenuSelection)
      .where(eq(prepMenuSelection.prepSessionId, s.prepSessionId));

    if (selections.length > 0) {
      return selections.map(toSelectionRow);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// getTodaySession — find existing session for today, no auto-create
// ---------------------------------------------------------------------------

export async function getTodaySession(
  userId: number,
  teamView?: boolean,
  storeLocationId?: string,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgIds.length > 0
      ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
      : eq(prepSession.userId, userId);
  } else {
    userFilter = eq(prepSession.userId, userId);
  }

  const conditions = [userFilter, eq(prepSession.isEndedInd, false)];
  if (storeLocationId) conditions.push(eq(prepSession.storeLocationId, storeLocationId));

  const existing = await db
    .select()
    .from(prepSession)
    .where(and(...conditions))
    .orderBy(desc(prepSession.createdDttm));

  if (existing.length === 0) return null;

  // In team view, aggregate tasks from all sessions for today
  const sessionIds = existing.map((s) => s.prepSessionId);
  const tasks = await db
    .select()
    .from(prepTask)
    .where(inArray(prepTask.prepSessionId, sessionIds))
    .orderBy(desc(prepTask.priorityScore));

  return { session: toSessionRow(existing[0]), tasks: tasks.map(toTaskRow) };
}

// ---------------------------------------------------------------------------
// getPrepSession
// ---------------------------------------------------------------------------

export async function getPrepSession(
  sessionId: string,
  userId: number,
  teamView?: boolean,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  let ownerFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    ownerFilter = orgCtx.orgIds.length > 0
      ? and(eq(prepSession.prepSessionId, sessionId), inArray(prepSession.userId, orgCtx.orgMemberUserIds))
      : and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId));
  } else {
    ownerFilter = and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId));
  }

  const [session] = await db
    .select()
    .from(prepSession)
    .where(ownerFilter);

  if (!session) return null;

  const tasks = await db
    .select()
    .from(prepTask)
    .where(eq(prepTask.prepSessionId, sessionId))
    .orderBy(desc(prepTask.priorityScore));

  return { session: toSessionRow(session), tasks: tasks.map(toTaskRow) };
}

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

export async function updateTaskStatus(
  taskId: string,
  userId: number,
  status: string,
  assignedTo?: string,
): Promise<PrepTaskRow | null> {
  // Read previous status to detect real transitions (B10: prevent double-deduct).
  const [existing] = await db
    .select({ status: prepTask.status, prepSessionId: prepTask.prepSessionId })
    .from(prepTask)
    .where(and(eq(prepTask.prepTaskId, taskId), eq(prepTask.userId, userId)));
  if (!existing) return null;

  const prevStatus = existing.status;

  // B9: Guard against modifying ended sessions.
  const [sess] = await db
    .select({ isEndedInd: prepSession.isEndedInd, storeLocationId: prepSession.storeLocationId, organisationId: prepSession.organisationId })
    .from(prepSession)
    .where(eq(prepSession.prepSessionId, existing.prepSessionId));
  if (sess?.isEndedInd) return null;

  const updateValues: Record<string, unknown> = {
    status,
    updatedDttm: new Date(),
  };

  if (assignedTo !== undefined) updateValues.assignedTo = assignedTo;
  if (status === "completed") updateValues.completedAt = new Date();
  else updateValues.completedAt = null;

  const [updated] = await db
    .update(prepTask)
    .set(updateValues)
    .where(and(eq(prepTask.prepTaskId, taskId), eq(prepTask.userId, userId)))
    .returning();

  if (!updated) return null;

  // Stock deduction/restoration: only on real transitions to/from "completed".
  const becomingCompleted = status === "completed" && prevStatus !== "completed";
  const leavingCompleted = status !== "completed" && prevStatus === "completed";

  if (updated.ingredientId && sess?.storeLocationId && (becomingCompleted || leavingCompleted)) {
    const deductQty = Number(updated.quantityNeeded);
    if (deductQty > 0) {
      const [ing] = await db
        .select({ baseUnit: ingredient.baseUnit })
        .from(ingredient)
        .where(eq(ingredient.ingredientId, updated.ingredientId));
      const baseUnit = ing?.baseUnit ?? updated.unit;
      const nFrom = normalizeUnit(updated.unit);
      const nTo = normalizeUnit(baseUnit);
      let baseQty = deductQty;
      if (nFrom && nTo && nFrom !== nTo) {
        try { baseQty = sharedConvertUnit(deductQty, nFrom, nTo); }
        catch { baseQty = 0; }
      }
      if (baseQty > 0) {
        // B11: Only add back if a stock_level row exists (don't create phantom stock).
        try {
          if (becomingCompleted) {
            await deductStock(sess.storeLocationId, updated.ingredientId, baseQty);
          } else {
            const [stockRow] = await db
              .select({ id: stockLevel.stockLevelId })
              .from(stockLevel)
              .where(and(eq(stockLevel.storeLocationId, sess.storeLocationId), eq(stockLevel.ingredientId, updated.ingredientId)));
            if (stockRow) await addStock(sess.storeLocationId, updated.ingredientId, baseQty);
          }
          if (sess.organisationId) {
            await db.insert(consumptionLog).values({
              organisationId: sess.organisationId,
              storeLocationId: sess.storeLocationId,
              ingredientId: updated.ingredientId,
              menuItemId: updated.menuItemId,
              userId,
              quantity: String(deductQty),
              unit: updated.unit,
              reason: becomingCompleted ? "prep" : "return_to_stock",
              notes: `Prep task: ${updated.taskDescription}`,
            });
          }
        } catch (err) {
          logger.warn({ taskId, ingredientId: updated.ingredientId, baseQty, err }, "Stock adjustment failed — task status still updated");
        }
      }
    }
  }

  // Recalculate session counts
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${prepTask.status} = 'completed')::int`,
      skipped: sql<number>`count(*) filter (where ${prepTask.status} = 'skipped')::int`,
    })
    .from(prepTask)
    .where(eq(prepTask.prepSessionId, updated.prepSessionId));

  await db
    .update(prepSession)
    .set({
      tasksTotal: Number(counts.total),
      tasksCompleted: Number(counts.completed),
      tasksSkipped: Number(counts.skipped),
      updatedDttm: new Date(),
    })
    .where(eq(prepSession.prepSessionId, updated.prepSessionId));

  logger.info(
    { taskId, status, sessionId: updated.prepSessionId },
    "Prep task status updated",
  );

  return toTaskRow(updated);
}

// ---------------------------------------------------------------------------
// getIngredientCrossUsage
// ---------------------------------------------------------------------------

export async function getIngredientCrossUsage(
  sessionId: string,
  userId?: number,
  teamView?: boolean,
): Promise<CrossUsageRow[]> {
  let sessionFilter;
  if (teamView && userId) {
    const orgCtx = await getUserOrgContext(userId);
    if (orgCtx.orgIds.length > 0) {
      const [reqSession] = await db
        .select({ prepDate: prepSession.prepDate })
        .from(prepSession)
        .where(eq(prepSession.prepSessionId, sessionId));
      if (reqSession) {
        const orgSessions = await db
          .select({ prepSessionId: prepSession.prepSessionId })
          .from(prepSession)
          .where(and(
            inArray(prepSession.userId, orgCtx.orgMemberUserIds),
            eq(prepSession.prepDate, reqSession.prepDate),
          ));
        const orgSessionIds = orgSessions.map((s) => s.prepSessionId);
        sessionFilter = inArray(ingredientCrossUsage.prepSessionId, orgSessionIds.length > 0 ? orgSessionIds : [sessionId]);
      } else {
        sessionFilter = eq(ingredientCrossUsage.prepSessionId, sessionId);
      }
    } else {
      sessionFilter = eq(ingredientCrossUsage.prepSessionId, sessionId);
    }
  } else {
    // Non-teamView: verify the session belongs to this user before exposing data.
    if (userId) {
      const [own] = await db
        .select({ id: prepSession.prepSessionId })
        .from(prepSession)
        .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)));
      if (!own) return [];
    }
    sessionFilter = eq(ingredientCrossUsage.prepSessionId, sessionId);
  }

  const rows = await db
    .select()
    .from(ingredientCrossUsage)
    .where(sessionFilter)
    .orderBy(desc(ingredientCrossUsage.dishCount));

  return rows.map((r) => ({
    crossUsageId: r.crossUsageId,
    ingredientName: r.ingredientName,
    dishCount: r.dishCount,
    totalQuantity: Number(r.totalQuantity),
    unit: r.unit,
    dishNames: r.dishNames as string[],
  }));
}

// ---------------------------------------------------------------------------
// getHighImpactDishes
// ---------------------------------------------------------------------------

export async function getHighImpactDishes(
  userId: number,
  teamView?: boolean,
): Promise<HighImpactResult> {
  // Determine user scope
  let userIds: number[];
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userIds = orgCtx.orgIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
  } else {
    userIds = [userId];
  }

  // Check if user has menu items in Menu Intelligence
  const menuItems = await db
    .select()
    .from(menuItem)
    .where(inArray(menuItem.userId, userIds));

  const hasMenuItems = menuItems.length > 0;

  if (hasMenuItems) {
    // ---- Menu Intelligence path: rank menu items by complexity ----
    // Load ingredient counts per menu item
    const menuItemIds = menuItems.map((mi) => mi.menuItemId);
    const ingredientRows = await db
      .select({
        menuItemId: menuItemIngredient.menuItemId,
        count: sql<number>`count(*)::int`,
      })
      .from(menuItemIngredient)
      .where(inArray(menuItemIngredient.menuItemId, menuItemIds))
      .groupBy(menuItemIngredient.menuItemId);

    const ingredientCountMap = new Map<string, number>();
    for (const row of ingredientRows) {
      ingredientCountMap.set(row.menuItemId, Number(row.count));
    }

    // Classification weights for complexity scoring
    const classificationWeights: Record<string, number> = {
      star: 4,
      plowhorse: 3,
      puzzle: 2,
      dog: 1,
      unclassified: 2,
    };

    const dishes: HighImpactDish[] = menuItems.map((mi) => {
      const ingCount = ingredientCountMap.get(mi.menuItemId) ?? 0;
      const classWeight = classificationWeights[mi.classification] ?? 2;
      // Complexity = ingredient count * classification weight
      const complexityScore = ingCount * classWeight;
      const classLabel = mi.classification.charAt(0).toUpperCase() + mi.classification.slice(1);

      return {
        recipeId: "",
        menuItemId: mi.menuItemId,
        title: mi.name,
        ingredientCount: ingCount,
        totalPrepMinutes: 0,
        complexityScore: Math.round(complexityScore * 100) / 100,
        classification: classLabel,
      };
    });

    dishes.sort((a, b) => b.complexityScore - a.complexityScore);
    return { dishes: dishes.slice(0, 10), hasMenuItems: true };
  }

  // ---- Recipe fallback path (current behavior) ----
  const userFilter = teamView
    ? and(inArray(recipe.userId, userIds), eq(recipe.archivedInd, false))
    : and(eq(recipe.userId, userId), eq(recipe.archivedInd, false));

  const recipes = await db
    .select()
    .from(recipe)
    .where(userFilter);

  const dishes: HighImpactDish[] = [];

  for (const r of recipes) {
    const data = r.recipeData as Record<string, unknown>;
    const ingredients = data.ingredients as Array<Record<string, string>> | undefined;
    const ingredientCount = ingredients?.length ?? 0;
    const prepMinutes = parseTimeToMinutes((data.prepTime as string) || "");
    const cookMinutes = parseTimeToMinutes((data.cookTime as string) || "");
    const totalPrepMinutes = prepMinutes + cookMinutes;

    const complexityScore = ingredientCount * (totalPrepMinutes / 10 + 1);

    dishes.push({
      recipeId: r.recipeId,
      menuItemId: null,
      title: r.title,
      ingredientCount,
      totalPrepMinutes,
      complexityScore: Math.round(complexityScore * 100) / 100,
      classification: null,
    });
  }

  dishes.sort((a, b) => b.complexityScore - a.complexityScore);
  return { dishes: dishes.slice(0, 10), hasMenuItems: false };
}

// ---------------------------------------------------------------------------
// getSessionHistory
// ---------------------------------------------------------------------------

export async function getSessionHistory(
  userId: number,
  limit: number = 20,
  teamView?: boolean,
  storeLocationId?: string,
): Promise<PrepSessionRow[]> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgIds.length > 0
      ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
      : eq(prepSession.userId, userId);
  } else {
    userFilter = eq(prepSession.userId, userId);
  }

  const conditions = [userFilter];
  if (storeLocationId) conditions.push(eq(prepSession.storeLocationId, storeLocationId));

  const rows = await db
    .select()
    .from(prepSession)
    .where(and(...conditions))
    .orderBy(desc(prepSession.prepDate))
    .limit(limit);

  return rows.map(toSessionRow);
}

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------

export async function endSession(
  sessionId: string,
  userId: number,
  actualCovers?: number,
): Promise<PrepSessionRow | null> {
  const updateValues: Record<string, unknown> = {
    isEndedInd: true,
    updatedDttm: new Date(),
  };
  if (actualCovers !== undefined) updateValues.actualCovers = actualCovers;

  const [updated] = await db
    .update(prepSession)
    .set(updateValues)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId), eq(prepSession.isEndedInd, false)))
    .returning();

  if (!updated) return null;

  logger.info(
    { sessionId, actualCovers },
    "Prep session ended",
  );

  return toSessionRow(updated);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSessionRow(r: typeof prepSession.$inferSelect): PrepSessionRow {
  return {
    prepSessionId: r.prepSessionId,
    userId: r.userId,
    prepDate: r.prepDate,
    expectedCovers: r.expectedCovers,
    actualCovers: r.actualCovers,
    tasksTotal: r.tasksTotal,
    tasksCompleted: r.tasksCompleted,
    tasksSkipped: r.tasksSkipped,
    notes: r.notes,
    isEnded: r.isEndedInd,
    createdDttm: r.createdDttm.toISOString(),
    updatedDttm: r.updatedDttm.toISOString(),
  };
}

function toTaskRow(r: typeof prepTask.$inferSelect): PrepTaskRow {
  return {
    prepTaskId: r.prepTaskId,
    prepSessionId: r.prepSessionId,
    menuItemId: r.menuItemId,
    recipeId: r.recipeId,
    taskDescription: r.taskDescription,
    ingredientName: r.ingredientName,
    quantityNeeded: Number(r.quantityNeeded),
    unit: r.unit,
    prepTimeMinutes: r.prepTimeMinutes,
    priorityScore: Number(r.priorityScore),
    priorityTier: r.priorityTier,
    ingredientId: r.ingredientId,
    station: r.station,
    onHandQty: r.onHandQty != null ? Number(r.onHandQty) : null,
    prepNeeded: r.prepNeeded != null ? Number(r.prepNeeded) : null,
    useBy: r.useBy ?? null,
    isOverPrep: r.isOverPrepInd,
    status: r.status,
    assignedTo: r.assignedTo,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdDttm: r.createdDttm.toISOString(),
  };
}

function toSelectionRow(r: typeof prepMenuSelection.$inferSelect): MenuSelectionRow {
  return {
    selectionId: r.selectionId,
    prepSessionId: r.prepSessionId,
    recipeId: r.recipeId,
    menuItemId: r.menuItemId,
    dishName: r.dishName,
    expectedPortions: r.expectedPortions,
    category: r.category,
    createdDttm: r.createdDttm.toISOString(),
  };
}
