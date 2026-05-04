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
} from "../db/schema.js";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { getUserOrgContext } from "./orgContextService.js";

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
  station: string | null;
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

  const [row] = await db
    .insert(prepSession)
    .values({
      userId,
      organisationId: orgCtx.primaryOrgId,
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

  // Delete any existing selections for this session (replace mode)
  await db
    .delete(prepMenuSelection)
    .where(eq(prepMenuSelection.prepSessionId, sessionId));

  if (selections.length === 0) return [];

  const rows = await db
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

interface IngredientAccum {
  dishes: string[];
  recipeIds: string[];
  menuItemIds: string[];
  totalQuantity: number;
  unit: string;
  prepTime: number;
  classificationWeight: number;
}

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

  // Clear any existing tasks for this session (regenerate mode)
  await db.delete(prepTask).where(eq(prepTask.prepSessionId, sessionId));
  await db.delete(ingredientCrossUsage).where(eq(ingredientCrossUsage.prepSessionId, sessionId));

  // Read selections
  const selections = await db
    .select()
    .from(prepMenuSelection)
    .where(eq(prepMenuSelection.prepSessionId, sessionId));

  if (selections.length === 0) {
    await db
      .update(prepSession)
      .set({ tasksTotal: 0, updatedDttm: new Date() })
      .where(eq(prepSession.prepSessionId, sessionId));
    return [];
  }

  // Classification weights for priority scoring
  const classificationWeights: Record<string, number> = {
    star: 4,
    plowhorse: 3,
    puzzle: 2,
    dog: 1,
    unclassified: 2,
  };

  // Preload menu items for classification lookup
  const menuItemIds = selections
    .map((s) => s.menuItemId)
    .filter((id): id is string => id !== null);

  const menuItemsMap = new Map<string, typeof menuItem.$inferSelect>();
  if (menuItemIds.length > 0) {
    const mis = await db
      .select()
      .from(menuItem)
      .where(inArray(menuItem.menuItemId, menuItemIds));
    for (const mi of mis) {
      menuItemsMap.set(mi.menuItemId, mi);
    }
  }

  // Preload recipes for recipe-based selections
  const recipeIds = selections
    .map((s) => s.recipeId)
    .filter((id): id is string => id !== null);

  const recipesMap = new Map<string, typeof recipe.$inferSelect>();
  if (recipeIds.length > 0) {
    const recs = await db
      .select()
      .from(recipe)
      .where(inArray(recipe.recipeId, recipeIds));
    for (const r of recs) {
      recipesMap.set(r.recipeId, r);
    }
  }

  // Build ingredient map across all selected dishes
  const ingredientMap = new Map<string, IngredientAccum>();

  for (const sel of selections) {
    const portionsNeeded = sel.expectedPortions;

    if (sel.menuItemId && menuItemsMap.has(sel.menuItemId)) {
      // Menu item path: get ingredients from menu_item_ingredient
      const mi = menuItemsMap.get(sel.menuItemId)!;
      const classification = mi.classification ?? "unclassified";
      const weight = classificationWeights[classification] ?? 2;

      const miIngredients = await db
        .select()
        .from(menuItemIngredient)
        .where(eq(menuItemIngredient.menuItemId, sel.menuItemId));

      for (const ing of miIngredients) {
        const key = ing.ingredientName.toLowerCase().trim();
        // menu_item_ingredient quantities are per-serving already;
        // multiply by expected portions
        const scaledAmount = Number(ing.quantity) * portionsNeeded;

        const existing = ingredientMap.get(key);
        if (existing) {
          existing.dishes.push(sel.dishName);
          existing.menuItemIds.push(sel.menuItemId);
          existing.totalQuantity += scaledAmount;
          existing.classificationWeight = Math.max(existing.classificationWeight, weight);
        } else {
          ingredientMap.set(key, {
            dishes: [sel.dishName],
            recipeIds: [],
            menuItemIds: [sel.menuItemId],
            totalQuantity: scaledAmount,
            unit: ing.unit,
            prepTime: 0,
            classificationWeight: weight,
          });
        }
      }
    } else if (sel.recipeId && recipesMap.has(sel.recipeId)) {
      // Recipe path: parse ingredients from recipe.recipeData JSONB
      const r = recipesMap.get(sel.recipeId)!;
      const data = r.recipeData as Record<string, unknown>;
      const ingredients = data.ingredients as Array<{
        amount?: string;
        unit?: string;
        name?: string;
      }> | undefined;

      if (!ingredients || !Array.isArray(ingredients)) continue;

      const recipeYield = parseYieldToServings((data.yield as string) || "");
      const prepTime = parseTimeToMinutes((data.prepTime as string) || "");
      const cookTime = parseTimeToMinutes((data.cookTime as string) || "");
      const totalTime = prepTime + cookTime;

      // Try to match to a menu item for classification weight
      const matchedMi = [...menuItemsMap.values()].find(
        (mi) => mi.name.toLowerCase() === r.title.toLowerCase(),
      );
      const classification = matchedMi?.classification ?? "unclassified";
      const weight = classificationWeights[classification] ?? 2;

      for (const ing of ingredients) {
        if (!ing.name) continue;
        const key = ing.name.toLowerCase().trim();
        const amount = parseAmountToNumber(ing.amount ?? "0");
        // Scale: (amount / recipe yield) * expected portions
        const scaledAmount = amount * (portionsNeeded / (recipeYield || 4));

        const existing = ingredientMap.get(key);
        if (existing) {
          existing.dishes.push(sel.dishName);
          existing.recipeIds.push(sel.recipeId);
          if (matchedMi) existing.menuItemIds.push(matchedMi.menuItemId);
          existing.totalQuantity += scaledAmount;
          existing.prepTime = Math.max(existing.prepTime, totalTime);
          existing.classificationWeight = Math.max(existing.classificationWeight, weight);
        } else {
          ingredientMap.set(key, {
            dishes: [sel.dishName],
            recipeIds: [sel.recipeId],
            menuItemIds: matchedMi ? [matchedMi.menuItemId] : [],
            totalQuantity: scaledAmount,
            unit: ing.unit || "ea",
            prepTime: totalTime,
            classificationWeight: weight,
          });
        }
      }
    }
  }

  // Calculate priority scores and build task list
  const taskEntries: Array<{
    ingredientName: string;
    accum: IngredientAccum;
    priorityScore: number;
    tier: string;
  }> = [];

  for (const [name, accum] of ingredientMap.entries()) {
    const crossUsageCount = accum.dishes.length;
    const priorityScore =
      crossUsageCount * (accum.prepTime / 10 + 1) * accum.classificationWeight;
    taskEntries.push({ ingredientName: name, accum, priorityScore, tier: "" });
  }

  // Sort by priority descending
  taskEntries.sort((a, b) => b.priorityScore - a.priorityScore);

  // Assign tiers
  const total = taskEntries.length;
  const topCutoff = Math.ceil(total * 0.3);
  const midCutoff = Math.ceil(total * 0.7);

  for (let i = 0; i < taskEntries.length; i++) {
    if (i < topCutoff) {
      taskEntries[i].tier = "start_first";
    } else if (i < midCutoff) {
      taskEntries[i].tier = "then_these";
    } else {
      taskEntries[i].tier = "can_wait";
    }
  }

  // Insert prep_task rows
  const taskRows: PrepTaskRow[] = [];

  for (const entry of taskEntries) {
    const acc = entry.accum;

    const [row] = await db
      .insert(prepTask)
      .values({
        prepSessionId: sessionId,
        userId,
        menuItemId: acc.menuItemIds[0] ?? null,
        recipeId: acc.recipeIds[0] ?? null,
        taskDescription: `Prep ${entry.ingredientName} for ${acc.dishes.join(", ")}`,
        ingredientName: entry.ingredientName,
        quantityNeeded: String(Math.round(acc.totalQuantity * 1000) / 1000),
        unit: acc.unit,
        prepTimeMinutes: acc.prepTime > 0 ? acc.prepTime : null,
        priorityScore: String(Math.round(entry.priorityScore * 100) / 100),
        priorityTier: entry.tier,
      })
      .returning();

    taskRows.push(toTaskRow(row));
  }

  // Insert ingredient cross-usage rows (only for ingredients in 2+ dishes)
  for (const [name, accum] of ingredientMap.entries()) {
    if (accum.dishes.length < 2) continue;

    await db.insert(ingredientCrossUsage).values({
      userId,
      prepSessionId: sessionId,
      ingredientName: name,
      dishCount: accum.dishes.length,
      totalQuantity: String(Math.round(accum.totalQuantity * 1000) / 1000),
      unit: accum.unit,
      dishNames: accum.dishes,
    });
  }

  // Update session tasksTotal
  await db
    .update(prepSession)
    .set({ tasksTotal: taskRows.length, updatedDttm: new Date() })
    .where(eq(prepSession.prepSessionId, sessionId));

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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgIds.length > 0
      ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
      : eq(prepSession.userId, userId);
  } else {
    userFilter = eq(prepSession.userId, userId);
  }

  const conditions = [userFilter, eq(prepSession.prepDate, today)];
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
  const updateValues: Record<string, unknown> = {
    status,
    updatedDttm: new Date(),
  };

  if (assignedTo !== undefined) updateValues.assignedTo = assignedTo;
  if (status === "completed") updateValues.completedAt = new Date();

  const [updated] = await db
    .update(prepTask)
    .set(updateValues)
    .where(and(eq(prepTask.prepTaskId, taskId), eq(prepTask.userId, userId)))
    .returning();

  if (!updated) return null;

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
    updatedDttm: new Date(),
  };
  if (actualCovers !== undefined) updateValues.actualCovers = actualCovers;

  const [updated] = await db
    .update(prepSession)
    .set(updateValues)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)))
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
    station: r.station,
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
