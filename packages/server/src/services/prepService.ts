/**
 * @module services/prepService
 *
 * Domain logic for the Kitchen Operations Copilot Lite module.
 * Handles prep session creation, task generation from recipes,
 * ingredient cross-usage analysis, and session lifecycle management.
 */

import pino from "pino";
import { db } from "../db/index.js";
import {
  prepSession,
  prepTask,
  ingredientCrossUsage,
  recipe,
  menuItem,
} from "../db/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

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
  title: string;
  ingredientCount: number;
  totalPrepMinutes: number;
  complexityScore: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse human-readable time strings into minutes.
 * Handles: "15 mins", "1 hour 30 mins", "45 minutes", "1h 30m", "2 hours"
 */
export function parseTimeToMinutes(timeStr: string): number {
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
export function parseYieldToServings(yieldStr: string): number {
  if (!yieldStr) return 4;
  const match = yieldStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Parse ingredient amount strings into numbers.
 * Handles: "2", "1.5", "1/2", "1 1/2", "3/4"
 */
export function parseAmountToNumber(amount: string): number {
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
// createPrepSession
// ---------------------------------------------------------------------------

export async function createPrepSession(
  userId: number,
  prepDate: string,
  expectedCovers?: number,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] }> {
  const [row] = await db
    .insert(prepSession)
    .values({
      userId,
      prepDate,
      expectedCovers: expectedCovers ?? null,
    })
    .returning();

  logger.info(
    { prepSessionId: row.prepSessionId, userId, prepDate },
    "Prep session created",
  );

  const tasks = await calculatePrepTasks(userId, row.prepSessionId, expectedCovers);

  // Re-fetch session to get updated tasksTotal
  const [updated] = await db
    .select()
    .from(prepSession)
    .where(eq(prepSession.prepSessionId, row.prepSessionId));

  return { session: toSessionRow(updated), tasks };
}

// ---------------------------------------------------------------------------
// calculatePrepTasks
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

export async function calculatePrepTasks(
  userId: number,
  sessionId: string,
  expectedCovers?: number,
): Promise<PrepTaskRow[]> {
  // Load user's active recipes
  const recipes = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.userId, userId), eq(recipe.archivedInd, false)));

  if (recipes.length === 0) {
    logger.info({ userId }, "No active recipes found for prep task generation");
    return [];
  }

  // Load menu items for classification weighting
  const menuItems = await db
    .select()
    .from(menuItem)
    .where(eq(menuItem.userId, userId));

  const classificationWeights: Record<string, number> = {
    star: 4,
    plowhorse: 3,
    puzzle: 2,
    dog: 1,
    unclassified: 2,
  };

  // Build a map of recipe title → menu item for classification lookup
  const menuItemByName = new Map<string, typeof menuItem.$inferSelect>();
  for (const mi of menuItems) {
    menuItemByName.set(mi.name.toLowerCase(), mi);
  }

  // Build ingredient map across all recipes
  const ingredientMap = new Map<string, IngredientAccum>();

  for (const r of recipes) {
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

    // Find matching menu item for classification weight
    const matchedMenuItem = menuItemByName.get(r.title.toLowerCase());
    const classification = matchedMenuItem?.classification ?? "unclassified";
    const weight = classificationWeights[classification] ?? 2;

    for (const ing of ingredients) {
      if (!ing.name) continue;
      const key = ing.name.toLowerCase().trim();
      const amount = parseAmountToNumber(ing.amount ?? "0");
      const scaledAmount = expectedCovers
        ? amount * (expectedCovers / (recipeYield || 4))
        : amount;

      const existing = ingredientMap.get(key);
      if (existing) {
        existing.dishes.push(r.title);
        existing.recipeIds.push(r.recipeId);
        if (matchedMenuItem) existing.menuItemIds.push(matchedMenuItem.menuItemId);
        existing.totalQuantity += scaledAmount;
        existing.prepTime = Math.max(existing.prepTime, totalTime);
        existing.classificationWeight = Math.max(existing.classificationWeight, weight);
      } else {
        ingredientMap.set(key, {
          dishes: [r.title],
          recipeIds: [r.recipeId],
          menuItemIds: matchedMenuItem ? [matchedMenuItem.menuItemId] : [],
          totalQuantity: scaledAmount,
          unit: ing.unit || "ea",
          prepTime: totalTime,
          classificationWeight: weight,
        });
      }
    }
  }

  // Calculate priority scores and build task list
  const taskEntries: Array<{
    ingredientName: string;
    accum: IngredientAccum;
    priorityScore: number;
  }> = [];

  for (const [name, accum] of ingredientMap.entries()) {
    const crossUsageCount = accum.dishes.length;
    const priorityScore =
      crossUsageCount * (accum.prepTime / 10 + 1) * accum.classificationWeight;
    taskEntries.push({ ingredientName: name, accum, priorityScore });
  }

  // Sort by priority descending
  taskEntries.sort((a, b) => b.priorityScore - a.priorityScore);

  // Assign tiers
  const total = taskEntries.length;
  const topCutoff = Math.ceil(total * 0.3);
  const midCutoff = Math.ceil(total * 0.7);

  for (let i = 0; i < taskEntries.length; i++) {
    if (i < topCutoff) {
      (taskEntries[i] as any).tier = "start_first";
    } else if (i < midCutoff) {
      (taskEntries[i] as any).tier = "then_these";
    } else {
      (taskEntries[i] as any).tier = "can_wait";
    }
  }

  // Insert prep_task rows
  const taskRows: PrepTaskRow[] = [];

  for (const entry of taskEntries) {
    const acc = entry.accum;
    const tier = (entry as any).tier as string;

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
        priorityTier: tier,
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
    { sessionId, taskCount: taskRows.length },
    "Prep tasks calculated and inserted",
  );

  return taskRows;
}

// ---------------------------------------------------------------------------
// getPrepSession
// ---------------------------------------------------------------------------

export async function getPrepSession(
  sessionId: string,
  userId: number,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  const [session] = await db
    .select()
    .from(prepSession)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)));

  if (!session) return null;

  const tasks = await db
    .select()
    .from(prepTask)
    .where(eq(prepTask.prepSessionId, sessionId))
    .orderBy(desc(prepTask.priorityScore));

  return { session: toSessionRow(session), tasks: tasks.map(toTaskRow) };
}

// ---------------------------------------------------------------------------
// getTodaySession
// ---------------------------------------------------------------------------

export async function getTodaySession(
  userId: number,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const [existing] = await db
    .select()
    .from(prepSession)
    .where(and(eq(prepSession.userId, userId), eq(prepSession.prepDate, today)));

  if (existing) {
    const tasks = await db
      .select()
      .from(prepTask)
      .where(eq(prepTask.prepSessionId, existing.prepSessionId))
      .orderBy(desc(prepTask.priorityScore));

    return { session: toSessionRow(existing), tasks: tasks.map(toTaskRow) };
  }

  // No session for today — create one
  return createPrepSession(userId, today);
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
): Promise<CrossUsageRow[]> {
  const rows = await db
    .select()
    .from(ingredientCrossUsage)
    .where(eq(ingredientCrossUsage.prepSessionId, sessionId))
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
): Promise<HighImpactDish[]> {
  const recipes = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.userId, userId), eq(recipe.archivedInd, false)));

  const dishes: HighImpactDish[] = [];

  for (const r of recipes) {
    const data = r.recipeData as Record<string, unknown>;
    const ingredients = data.ingredients as Array<Record<string, string>> | undefined;
    const ingredientCount = ingredients?.length ?? 0;
    const prepMinutes = parseTimeToMinutes((data.prepTime as string) || "");
    const cookMinutes = parseTimeToMinutes((data.cookTime as string) || "");
    const totalPrepMinutes = prepMinutes + cookMinutes;

    // Complexity: ingredient count × total time (higher = more complex)
    const complexityScore = ingredientCount * (totalPrepMinutes / 10 + 1);

    dishes.push({
      recipeId: r.recipeId,
      title: r.title,
      ingredientCount,
      totalPrepMinutes,
      complexityScore: Math.round(complexityScore * 100) / 100,
    });
  }

  dishes.sort((a, b) => b.complexityScore - a.complexityScore);
  return dishes.slice(0, 10);
}

// ---------------------------------------------------------------------------
// getSessionHistory
// ---------------------------------------------------------------------------

export async function getSessionHistory(
  userId: number,
  limit: number = 20,
): Promise<PrepSessionRow[]> {
  const rows = await db
    .select()
    .from(prepSession)
    .where(eq(prepSession.userId, userId))
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
