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
  storeLocation,
  user as user_,
} from "../db/schema.js";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { getUserOrgContext } from "./orgContextService.js";
import { assertLocationAccess } from "./locationContextService.js";
import type { TokenPayload } from "./authService.js";
import { canManageSession, canWorkSession } from "./prepAccess.js";
import { AppError } from "../utils/appError.js";
import { insertOnce } from "../utils/retrySafe.js";
import { aggregatePrepLines, attachOnHand, type PrepSourceLine } from "./prepMath.js";
import { convertUnit as sharedConvertUnit, normalizeUnit } from "@culinaire/shared";
import { addStock, deductStock } from "./stockService.js";
import { recordOpsEvent } from "./brainCaptureService.js";
import type { DbOrTx } from "./auditService.js";
import { parseTimeToMinutes, parseYieldToServings, parseAmountToNumber } from "./prepErrors.js";

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
  /** The user who ticked it. */
  completedBy: number | null;
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

export interface CreatePrepSessionInput {
  /** Chosen by the phone so a retried send finds its own session instead of making a second one. */
  prepSessionId?: string;
  prepDate: string;
  expectedCovers?: number;
  /** Where the prep is for. Absent: the location saved on the user (the web sends none). */
  storeLocationId?: string;
}

/**
 * Creates a prep session without auto-generating tasks. A location named in the request must be one the
 * caller works at. `replay` is true when `prepSessionId` was already created by this user.
 */
export async function createPrepSession(
  user: TokenPayload,
  input: CreatePrepSessionInput,
): Promise<{ session: PrepSessionRow; replay: boolean }> {
  const userId = user.sub;
  let organisationId: number | null;
  let storeLocationId: string | null;
  if (input.storeLocationId) {
    await assertLocationAccess(user, input.storeLocationId);
    const [loc] = await db
      .select({ organisationId: storeLocation.organisationId })
      .from(storeLocation)
      .where(eq(storeLocation.storeLocationId, input.storeLocationId));
    if (!loc) throw new AppError(404, "NOT_FOUND", "Location not found");
    organisationId = loc.organisationId;
    storeLocationId = input.storeLocationId;
  } else {
    const orgCtx = await getUserOrgContext(userId);
    const [userRow] = await db
      .select({ selectedLocationId: user_.selectedLocationId })
      .from(user_)
      .where(eq(user_.userId, userId));
    organisationId = orgCtx.primaryOrgId;
    storeLocationId = userRow?.selectedLocationId ?? null;
  }

  const { row, replay } = await insertOnce(
    userId,
    () =>
      db
        .insert(prepSession)
        .values({
          prepSessionId: input.prepSessionId,
          userId,
          organisationId,
          storeLocationId,
          prepDate: input.prepDate,
          expectedCovers: input.expectedCovers ?? null,
        })
        .onConflictDoNothing({ target: prepSession.prepSessionId })
        .returning(),
    async () => (await db.select().from(prepSession).where(eq(prepSession.prepSessionId, input.prepSessionId!)))[0],
  );

  if (!replay) {
    logger.info(
      { prepSessionId: row.prepSessionId, userId, prepDate: input.prepDate },
      "Prep session created (menu-driven, no auto-generation)",
    );
  }

  return { session: toSessionRow(row), replay };
}

// ---------------------------------------------------------------------------
// generateTasksFromSelections — THE KEY FUNCTION
// ---------------------------------------------------------------------------

/**
 * Generates prep tasks from the saved menu selections for a session (the creator, or a `prep:manage` holder
 * at its location). Each call rebuilds the list, as the web expects. A `requestId` makes a retry safe: the
 * second send of the same request answers with the stored tasks (`replay: true`) and rebuilds nothing, so
 * ticks made since survive.
 */
export async function generateTasksFromSelections(
  sessionId: string,
  user: TokenPayload,
  requestId?: string,
): Promise<{ tasks: PrepTaskRow[]; replay: boolean }> {
  const userId = user.sub;
  const [session] = await db.select().from(prepSession).where(eq(prepSession.prepSessionId, sessionId));

  if (!session) throw new AppError(404, "NOT_FOUND", "Prep session not found or not yours");
  if (!(await canManageSession(user, session))) {
    throw new AppError(403, "FORBIDDEN", "Only the creator or a prep manager at this location can generate tasks");
  }
  if (session.isEndedInd) throw new AppError(409, "PREP_SESSION_ENDED", "Cannot modify an ended prep session");
  if (requestId && session.generateRequestId === requestId) {
    return { tasks: await storedTasks(sessionId), replay: true };
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
  // Scoped to names present in selected recipes — avoids a full ingredient table scan.
  const categoryByName = new Map<string, string>();
  if (recipeIds.length > 0) {
    const recipeIngredientNames = [...new Set(
      [...recipesMap.values()].flatMap((r) => {
        const ings = (r.recipeData as Record<string, unknown>).ingredients as Array<{ name?: string }> | undefined;
        return Array.isArray(ings) ? ings.map((i) => i.name).filter((n): n is string => !!n) : [];
      }),
    )];
    if (recipeIngredientNames.length > 0) {
      const cats = await db
        .select({ name: ingredient.ingredientName, category: ingredient.ingredientCategory })
        .from(ingredient)
        .where(inArray(ingredient.ingredientName, recipeIngredientNames));
      for (const c of cats) categoryByName.set(c.name.toLowerCase().trim(), c.category);
    }
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
  const { rows: taskRows, replay } = await db.transaction(async (tx) => {
    // FOR UPDATE serializes concurrent generateTasksFromSelections calls on the
    // same session — the second caller blocks until the first commits/rolls back.
    const [locked] = await tx
      .select({ isEndedInd: prepSession.isEndedInd, generateRequestId: prepSession.generateRequestId })
      .from(prepSession)
      .where(eq(prepSession.prepSessionId, sessionId))
      .for("update");
    if (!locked) throw new AppError(404, "NOT_FOUND", "Prep session not found or not yours");
    if (locked.isEndedInd) throw new AppError(409, "PREP_SESSION_ENDED", "Cannot modify an ended prep session");
    // The same request, sent twice at once: the second waited for the lock and finds the first one's work.
    if (requestId && locked.generateRequestId === requestId) {
      return { rows: await storedTasks(sessionId, tx), replay: true };
    }

    await tx.delete(prepTask).where(eq(prepTask.prepSessionId, sessionId));
    await tx.delete(ingredientCrossUsage).where(eq(ingredientCrossUsage.prepSessionId, sessionId));

    const taskValues = scored.map(({ line, priorityScore }, i) => {
      const tier = i < topCutoff ? "start_first" : i < midCutoff ? "then_these" : "can_wait";
      return {
        prepSessionId: sessionId,
        userId: session.userId,
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
      };
    });
    const rows = taskValues.length > 0
      ? (await tx.insert(prepTask).values(taskValues).returning()).map(toTaskRow)
      : [];

    // Cross-usage: ingredients shared by 2+ dishes — batch insert.
    const crossUsageValues = aggregated
      .filter((line) => line.dishes.length >= 2)
      .map((line) => ({
        userId: session.userId,
        prepSessionId: sessionId,
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        dishCount: line.dishes.length,
        totalQuantity: String(Math.round(line.totalQuantity * 1000) / 1000),
        unit: line.unit,
        dishNames: line.dishes,
      }));
    if (crossUsageValues.length > 0) {
      await tx.insert(ingredientCrossUsage).values(crossUsageValues);
    }

    await tx
      .update(prepSession)
      .set({ tasksTotal: rows.length, generateRequestId: requestId ?? null, updatedDttm: new Date() })
      .where(eq(prepSession.prepSessionId, sessionId));

    return { rows, replay: false };
  });

  logger.info(
    { sessionId, taskCount: taskRows.length, selectionCount: selections.length },
    "Prep tasks generated from menu selections",
  );

  return { tasks: taskRows, replay };
}

/** The tasks a session already has, most urgent first. */
async function storedTasks(sessionId: string, tx: DbOrTx = db): Promise<PrepTaskRow[]> {
  const rows = await tx.select().from(prepTask).where(eq(prepTask.prepSessionId, sessionId)).orderBy(desc(prepTask.priorityScore));
  return rows.map(toTaskRow);
}

// ---------------------------------------------------------------------------
// getTodaySession — find existing session for today, no auto-create
// ---------------------------------------------------------------------------

/**
 * Finds an existing prep session for today without creating one.
 *
 * With `date` (the phone) "today" is that date's open session at `storeLocationId`, whoever created it:
 * every cook at the location works from the same list. Without it (the web) it stays the caller's newest
 * open session, optionally narrowed to a location.
 */
export async function getTodaySession(
  user: TokenPayload,
  teamView?: boolean,
  storeLocationId?: string,
  date?: string,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  const userId = user.sub;
  const conditions = [eq(prepSession.isEndedInd, false)];
  if (date && storeLocationId) {
    await assertLocationAccess(user, storeLocationId);
    conditions.push(eq(prepSession.prepDate, date), eq(prepSession.storeLocationId, storeLocationId));
  } else {
    let userFilter;
    if (teamView) {
      const orgCtx = await getUserOrgContext(userId);
      userFilter = orgCtx.orgMemberUserIds.length > 0
        ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
        : eq(prepSession.userId, userId);
    } else {
      userFilter = eq(prepSession.userId, userId);
    }
    conditions.push(userFilter);
    if (storeLocationId) conditions.push(eq(prepSession.storeLocationId, storeLocationId));
  }

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

/** Returns a prep session by ID: your own, a colleague's at a location you work at, or (team view) any in your organisation. */
export async function getPrepSession(
  sessionId: string,
  user: TokenPayload,
  teamView?: boolean,
): Promise<{ session: PrepSessionRow; tasks: PrepTaskRow[] } | null> {
  const [session] = await db.select().from(prepSession).where(eq(prepSession.prepSessionId, sessionId));
  if (!session || !(await canReadSession(user, session, teamView))) return null;

  const tasks = await db
    .select()
    .from(prepTask)
    .where(eq(prepTask.prepSessionId, sessionId))
    .orderBy(desc(prepTask.priorityScore));

  return { session: toSessionRow(session), tasks: tasks.map(toTaskRow) };
}

async function canReadSession(
  user: TokenPayload,
  session: typeof prepSession.$inferSelect,
  teamView?: boolean,
): Promise<boolean> {
  if (await canWorkSession(user, session)) return true;
  if (!teamView) return false;
  const orgCtx = await getUserOrgContext(user.sub);
  return orgCtx.orgMemberUserIds.includes(session.userId);
}

// ---------------------------------------------------------------------------
// updateTaskStatus
// ---------------------------------------------------------------------------

export interface TaskUpdate {
  status: string;
  /** `null` clears it. */
  assignedTo?: string | null;
  /** When the tick happened on the device (an offline tick); never later than now. */
  completedAt?: Date;
  /** The status the device last saw. If the task is somewhere else by now, nothing changes (409 PREP_TASK_CHANGED). */
  expectedStatus?: string;
}

/**
 * Updates one prep task. Any member who works at the session's location may; the server records who completed it.
 * The status change and its stock effect commit together or not at all.
 */
export async function updateTaskStatus(
  taskId: string,
  user: TokenPayload,
  update: TaskUpdate,
): Promise<PrepTaskRow> {
  const userId = user.sub;
  const { status } = update;

  const result = await db.transaction(async (tx) => {
    // FOR UPDATE: two devices ticking the same task take turns, so exactly one sees the transition.
    const [task] = await tx.select().from(prepTask).where(eq(prepTask.prepTaskId, taskId)).for("update");
    if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");

    const [sess] = await tx.select().from(prepSession).where(eq(prepSession.prepSessionId, task.prepSessionId));
    if (!sess || !(await canWorkSession(user, sess))) {
      throw new AppError(403, "FORBIDDEN", "You do not work at this session's location");
    }
    if (sess.isEndedInd) throw new AppError(409, "PREP_SESSION_ENDED", "This prep session has ended");

    const prevStatus = task.status;
    const unchanged = prevStatus === status;
    // Already where the device wants it (its own retry, or another device got there first): not a conflict.
    if (!unchanged && update.expectedStatus !== undefined && update.expectedStatus !== prevStatus) {
      throw new AppError(409, "PREP_TASK_CHANGED", `Another device changed this task to ${prevStatus}`);
    }

    const values: Record<string, unknown> = { updatedDttm: new Date() };
    if (update.assignedTo !== undefined) values.assignedTo = update.assignedTo;
    if (!unchanged) {
      values.status = status;
      if (status === "completed") {
        const now = new Date();
        values.completedAt = update.completedAt && update.completedAt < now ? update.completedAt : now;
        values.completedBy = userId;
      } else {
        values.completedAt = null;
        values.completedBy = null;
      }
    }
    const [updated] = await tx.update(prepTask).set(values).where(eq(prepTask.prepTaskId, taskId)).returning();

    // Stock deduction/restoration: only on real transitions to/from "completed".
    const becomingCompleted = status === "completed" && prevStatus !== "completed";
    const leavingCompleted = status !== "completed" && prevStatus === "completed";
    if (updated.ingredientId && sess.storeLocationId && (becomingCompleted || leavingCompleted)) {
      await adjustStockForTask(tx, updated, sess, userId, becomingCompleted);
    }

    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${prepTask.status} = 'completed')::int`,
        skipped: sql<number>`count(*) filter (where ${prepTask.status} = 'skipped')::int`,
      })
      .from(prepTask)
      .where(eq(prepTask.prepSessionId, updated.prepSessionId));

    await tx
      .update(prepSession)
      .set({
        tasksTotal: Number(counts.total),
        tasksCompleted: Number(counts.completed),
        tasksSkipped: Number(counts.skipped),
        updatedDttm: new Date(),
      })
      .where(eq(prepSession.prepSessionId, updated.prepSessionId));

    return updated;
  });

  logger.info({ taskId, status, sessionId: result.prepSessionId, userId }, "Prep task status updated");

  return toTaskRow(result);
}

/**
 * Moves stock for a task that was just completed (deduct) or un-completed (add back), and writes the
 * consumption row, inside the caller's transaction: if any of it fails the tick rolls back with it.
 *
 * Not tracked, so skipped on purpose: an ingredient with no stock row at this location, and a unit that
 * cannot be converted to the ingredient's base unit (logged as a warning; the item's set-up needs fixing).
 */
async function adjustStockForTask(
  tx: DbOrTx,
  task: typeof prepTask.$inferSelect,
  sess: typeof prepSession.$inferSelect,
  userId: number,
  deduct: boolean,
): Promise<void> {
  const deductQty = Number(task.quantityNeeded);
  if (!(deductQty > 0) || !task.ingredientId || !sess.storeLocationId) return;

  const [ing] = await tx
    .select({ baseUnit: ingredient.baseUnit })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, task.ingredientId));
  const baseUnit = ing?.baseUnit ?? task.unit;
  const nFrom = normalizeUnit(task.unit);
  const nTo = normalizeUnit(baseUnit);
  let baseQty = deductQty;
  if (nFrom && nTo && nFrom !== nTo) {
    try {
      baseQty = sharedConvertUnit(deductQty, nFrom, nTo);
    } catch {
      logger.warn({ taskId: task.prepTaskId, ingredientId: task.ingredientId, from: task.unit, to: baseUnit }, "Prep task unit cannot be converted to the base unit: no stock adjustment");
      return;
    }
  }
  if (!(baseQty > 0)) return;

  // B11: never create phantom stock: no stock row here means this location does not track the item.
  const [stockRow] = await tx
    .select({ id: stockLevel.stockLevelId })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, sess.storeLocationId), eq(stockLevel.ingredientId, task.ingredientId)));
  if (!stockRow) return;

  if (deduct) await deductStock(sess.storeLocationId, task.ingredientId, baseQty, tx);
  else await addStock(sess.storeLocationId, task.ingredientId, baseQty, tx);

  if (sess.organisationId) {
    await tx.insert(consumptionLog).values({
      organisationId: sess.organisationId,
      storeLocationId: sess.storeLocationId,
      ingredientId: task.ingredientId,
      menuItemId: task.menuItemId,
      userId,
      quantity: String(deductQty),
      unit: task.unit,
      baseQty: String(baseQty),
      reason: deduct ? "prep" : "return_to_stock",
      notes: `Prep task: ${task.taskDescription}`,
    });
  }
}

// ---------------------------------------------------------------------------
// getIngredientCrossUsage
// ---------------------------------------------------------------------------

/** Returns cross-usage data showing which ingredients appear across multiple prep tasks. */
export async function getIngredientCrossUsage(
  sessionId: string,
  user: TokenPayload,
  teamView?: boolean,
): Promise<CrossUsageRow[]> {
  const userId = user.sub;
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
    const [session] = await db.select().from(prepSession).where(eq(prepSession.prepSessionId, sessionId));
    if (!session || !(await canWorkSession(user, session))) return [];
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

/**
 * Marks a prep session as ended and records actual covers. The creator, or a `prep:manage` holder at its
 * location, may. A repeat (or an end by someone who got there first) succeeds with the session as it is.
 */
export async function endSession(
  sessionId: string,
  user: TokenPayload,
  actualCovers?: number,
): Promise<PrepSessionRow> {
  const userId = user.sub;
  const [session] = await db.select().from(prepSession).where(eq(prepSession.prepSessionId, sessionId));
  if (!session) throw new AppError(404, "NOT_FOUND", "Prep session not found or not yours");
  if (!(await canManageSession(user, session))) {
    throw new AppError(403, "FORBIDDEN", "Only the creator or a prep manager at this location can end this session");
  }

  const updateValues: Record<string, unknown> = {
    isEndedInd: true,
    updatedDttm: new Date(),
  };
  if (actualCovers !== undefined) updateValues.actualCovers = actualCovers;

  const [updated] = await db
    .update(prepSession)
    .set(updateValues)
    .where(and(eq(prepSession.prepSessionId, sessionId), eq(prepSession.isEndedInd, false)))
    .returning();

  if (!updated) return toSessionRow(session);

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
    completedBy: r.completedBy,
    createdDttm: r.createdDttm.toISOString(),
  };
}
