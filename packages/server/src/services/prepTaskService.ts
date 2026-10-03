/**
 * @module services/prepTaskService
 * Task management domain: session lifecycle, task generation, status updates, and history.
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
import { aggregatePrepLines, attachOnHand, type PrepSourceLine } from "./prepMath.js";
import { convertUnit as sharedConvertUnit, normalizeUnit } from "@culinaire/shared";
import { addStock, deductStock } from "./stockService.js";
import { recordOpsEvent } from "./brainCaptureService.js";
import { PrepError, parseTimeToMinutes, parseYieldToServings, parseAmountToNumber } from "./prepErrors.js";

const logger = pino({ name: "prepTaskService" });

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

// ---------------------------------------------------------------------------
// createPrepSession — creates session WITHOUT auto-generating tasks
// ---------------------------------------------------------------------------

/** Creates a prep session for the given user and date without auto-generating tasks. */
export async function createPrepSession(
  userId: number,
  prepDate: string,
  expectedCovers?: number,
): Promise<{ session: PrepSessionRow }> {
  const orgCtx = await getUserOrgContext(userId);

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
// generateTasksFromSelections — THE KEY FUNCTION
// ---------------------------------------------------------------------------

/** Generates prep tasks from the saved menu selections for a session. */
export async function generateTasksFromSelections(
  sessionId: string,
  userId: number,
): Promise<PrepTaskRow[]> {
  const [session] = await db
    .select()
    .from(prepSession)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)));

  if (!session) {
    throw new PrepError("Prep session not found or not yours", 404);
  }
  if (session.isEndedInd) {
    throw new PrepError("Cannot modify an ended prep session", 409);
  }

  const selections = await db
    .select()
    .from(prepMenuSelection)
    .where(eq(prepMenuSelection.prepSessionId, sessionId));

  const classificationWeights: Record<string, number> = {
    star: 4,
    plowhorse: 3,
    puzzle: 2,
    dog: 1,
    unclassified: 2,
  };

  const menuItemIds = selections.map((s) => s.menuItemId).filter((id): id is string => id !== null);
  const recipeIds = selections.map((s) => s.recipeId).filter((id): id is string => id !== null);

  // IDOR guard: scope menu items and recipes to the caller's org so a selection
  // can't reference another user's data by guessing a UUID.
  const orgCtx = await getUserOrgContext(userId);
  const authorisedUserIds = orgCtx.orgMemberUserIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];

  const menuItemsMap = new Map<string, typeof menuItem.$inferSelect>();
  if (menuItemIds.length > 0) {
    const mis = await db.select().from(menuItem).where(
      and(inArray(menuItem.menuItemId, menuItemIds), inArray(menuItem.userId, authorisedUserIds)),
    );
    for (const mi of mis) menuItemsMap.set(mi.menuItemId, mi);
  }

  const recipesMap = new Map<string, typeof recipe.$inferSelect>();
  if (recipeIds.length > 0) {
    const recs = await db.select().from(recipe).where(
      and(inArray(recipe.recipeId, recipeIds), inArray(recipe.userId, authorisedUserIds)),
    );
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
  const categoryByName = new Map<string, string>();
  if (recipeIds.length > 0) {
    const allCats = await db
      .select({ name: ingredient.ingredientName, category: ingredient.ingredientCategory })
      .from(ingredient);
    for (const c of allCats) categoryByName.set(c.name.toLowerCase().trim(), c.category);
  }

  const sourceLines: PrepSourceLine[] = [];

  for (const sel of selections) {
    const portionsNeeded = sel.expectedPortions;

    if (sel.menuItemId && menuItemsMap.has(sel.menuItemId)) {
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
    // FOR UPDATE serializes concurrent generateTasksFromSelections calls on the
    // same session — the second caller blocks until the first commits/rolls back.
    const [locked] = await tx
      .select({ isEndedInd: prepSession.isEndedInd })
      .from(prepSession)
      .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.userId, userId)))
      .for("update");
    if (!locked) throw new PrepError("Prep session not found or not yours", 404);
    if (locked.isEndedInd) throw new PrepError("Cannot modify an ended prep session", 409);

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

    // Cross-usage: ingredients shared by 2+ dishes.
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
// getTodaySession — find existing session for today, no auto-create
// ---------------------------------------------------------------------------

/** Finds an existing prep session for today without creating one. */
export async function getTodaySession(
  userId: number,
  teamView?: boolean,
  storeLocationId?: string,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgMemberUserIds.length > 0
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

  // Return the most-recent session and its tasks only — not tasks from every
  // org-member session (which were only fetched to let the user see THEIR session
  // even when another member started one today).
  const tasks = await db
    .select()
    .from(prepTask)
    .where(eq(prepTask.prepSessionId, existing[0].prepSessionId))
    .orderBy(desc(prepTask.priorityScore));

  return { session: toSessionRow(existing[0]), tasks: tasks.map(toTaskRow) };
}

// ---------------------------------------------------------------------------
// getPrepSession
// ---------------------------------------------------------------------------

/** Returns a prep session by ID, scoped to the given user. */
export async function getPrepSession(
  sessionId: string,
  userId: number,
  teamView?: boolean,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  let ownerFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    ownerFilter = orgCtx.orgMemberUserIds.length > 0
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

/** Updates the status of a single prep task. */
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

  // CAS guard: only update if the status in the DB still matches what we read above.
  // Without this, two concurrent calls both read prevStatus="pending", both pass the
  // becomingCompleted check, and both deduct stock.
  const [updated] = await db
    .update(prepTask)
    .set(updateValues)
    .where(and(eq(prepTask.prepTaskId, taskId), eq(prepTask.userId, userId), eq(prepTask.status, prevStatus)))
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
              baseQty: String(baseQty),
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

/** Returns cross-usage data showing which ingredients appear across multiple prep tasks. */
export async function getIngredientCrossUsage(
  sessionId: string,
  userId?: number,
  teamView?: boolean,
): Promise<CrossUsageRow[]> {
  let sessionFilter;
  if (teamView && userId) {
    const orgCtx = await getUserOrgContext(userId);
    if (orgCtx.orgMemberUserIds.length > 0) {
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
// getSessionHistory
// ---------------------------------------------------------------------------

/** Returns paginated prep session history for the given user. */
export async function getSessionHistory(
  userId: number,
  limit: number = 20,
  teamView?: boolean,
  storeLocationId?: string,
): Promise<PrepSessionRow[]> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgMemberUserIds.length > 0
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

/** Marks a prep session as ended and records actual covers. */
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

  const prepDateStr =
    typeof updated.prepDate === "string"
      ? updated.prepDate
      : new Date(updated.prepDate).toISOString().slice(0, 10);
  void recordOpsEvent({
    userId,
    sourceType: "prep",
    scope: updated.organisationId ? "org" : "user",
    organisationId: updated.organisationId ?? null,
    sourceRef: sessionId,
    title: `Prep completed ${prepDateStr}`,
    prepDate: prepDateStr,
    tasksCompleted: updated.tasksCompleted ?? 0,
    tasksTotal: updated.tasksTotal ?? 0,
    actualCovers: updated.actualCovers ?? null,
    notes: updated.notes ?? null,
  });

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
