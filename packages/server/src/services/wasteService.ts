/**
 * @module services/wasteService
 *
 * Domain logic for the Waste Intelligence Lite module.
 * Handles waste log CRUD, aggregated summaries, ingredient
 * auto-complete, and AI-powered reuse suggestions.
 */

import crypto from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import pino from "pino";
import { db } from "../db/index.js";
import { wasteLog, user } from "../db/schema.js";
import { recipe } from "../db/schema.js";
import { eq, desc, sql, and, gte, lte, ilike, inArray } from "drizzle-orm";
import { getUserOrgContext, type OrgContext } from "./orgContextService.js";
import { getModel } from "./providerService.js";

const logger = pino({ name: "wasteService" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WasteLogInput {
  ingredientName: string;
  quantity: number;
  unit: string;
  estimatedCost?: number | null;
  reason?: string | null;
  notes?: string | null;
  shift?: string | null;
  loggedAt?: string | null;
}

export interface WasteLogRow {
  wasteLogId: string;
  userId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  estimatedCost: number | null;
  reason: string | null;
  notes: string | null;
  shift: string | null;
  loggedAt: string;
  createdDttm: string;
  loggedBy?: string | null;
}

export interface WasteSummary {
  totalWeight: number;
  totalCost: number;
  totalEntries: number;
  topByCost: { name: string; cost: number }[];
  topByWeight: { name: string; weight: number; unit: string }[];
  byReason: { reason: string; count: number; cost: number }[];
  dailyTotals: { date: string; weight: number; cost: number }[];
}

export interface ReuseSuggestion {
  id: string;
  ingredientName: string;
  quantityWasted: number;
  suggestion: string;
  type: "recipe" | "stock" | "special" | "staff_meal";
}

// ---------------------------------------------------------------------------
// logWaste
// ---------------------------------------------------------------------------

export async function logWaste(
  userId: number,
  data: WasteLogInput,
): Promise<WasteLogRow> {
  // Auto-set organisationId from user's org membership
  const orgCtx = await getUserOrgContext(userId);

  const [row] = await db
    .insert(wasteLog)
    .values({
      userId,
      organisationId: orgCtx.primaryOrgId,
      ingredientName: data.ingredientName.trim(),
      quantity: String(data.quantity),
      unit: data.unit.trim(),
      estimatedCost: data.estimatedCost != null ? String(data.estimatedCost) : null,
      reason: data.reason ?? null,
      notes: data.notes ?? null,
      shift: data.shift ?? null,
      loggedAt: data.loggedAt ? new Date(data.loggedAt) : new Date(),
    })
    .returning();

  logger.info(
    { wasteLogId: row.wasteLogId, userId, ingredient: row.ingredientName },
    "Waste entry logged",
  );

  return toRow(row);
}

// ---------------------------------------------------------------------------
// getWasteLogs
// ---------------------------------------------------------------------------

export async function getWasteLogs(
  userId: number,
  opts: { limit?: number; offset?: number; startDate?: string; endDate?: string; teamView?: boolean } = {},
): Promise<{ data: WasteLogRow[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let orgCtx: OrgContext | null = null;
  if (opts.teamView) {
    orgCtx = await getUserOrgContext(userId);
  }

  // If teamView and user has an org, filter by all org member userIds
  const userFilter = opts.teamView && orgCtx && orgCtx.orgIds.length > 0
    ? inArray(wasteLog.userId, orgCtx.orgMemberUserIds)
    : eq(wasteLog.userId, userId);

  const conditions = [userFilter];
  if (opts.startDate) conditions.push(gte(wasteLog.loggedAt, new Date(opts.startDate)));
  if (opts.endDate) conditions.push(lte(wasteLog.loggedAt, new Date(opts.endDate)));

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select({
        wasteLogId: wasteLog.wasteLogId,
        userId: wasteLog.userId,
        ingredientName: wasteLog.ingredientName,
        quantity: wasteLog.quantity,
        unit: wasteLog.unit,
        estimatedCost: wasteLog.estimatedCost,
        reason: wasteLog.reason,
        notes: wasteLog.notes,
        shift: wasteLog.shift,
        loggedAt: wasteLog.loggedAt,
        createdDttm: wasteLog.createdDttm,
        updatedDttm: wasteLog.updatedDttm,
        loggedBy: user.userName,
      })
      .from(wasteLog)
      .leftJoin(user, eq(wasteLog.userId, user.userId))
      .where(where)
      .orderBy(desc(wasteLog.loggedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(wasteLog)
      .where(where),
  ]);

  return {
    data: rows.map((r) => ({
      wasteLogId: r.wasteLogId,
      userId: r.userId,
      ingredientName: r.ingredientName,
      quantity: Number(r.quantity),
      unit: r.unit,
      estimatedCost: r.estimatedCost != null ? Number(r.estimatedCost) : null,
      reason: r.reason,
      notes: r.notes,
      shift: r.shift,
      loggedAt: r.loggedAt.toISOString(),
      createdDttm: r.createdDttm.toISOString(),
      loggedBy: r.loggedBy ?? null,
    })),
    total: Number(countResult[0]?.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// deleteWasteLog
// ---------------------------------------------------------------------------

export async function deleteWasteLog(
  wasteLogId: string,
  userId: number,
  orgCtx?: OrgContext,
): Promise<boolean> {
  // If org admin, allow deleting any entry from their org members
  if (orgCtx?.isOrgAdmin && orgCtx.orgIds.length > 0) {
    const result = await db
      .delete(wasteLog)
      .where(
        and(
          eq(wasteLog.wasteLogId, wasteLogId),
          inArray(wasteLog.userId, orgCtx.orgMemberUserIds),
        ),
      )
      .returning({ id: wasteLog.wasteLogId });

    const deleted = result.length > 0;
    if (deleted) {
      logger.info({ wasteLogId, userId, orgAdmin: true }, "Waste entry deleted by org admin");
    }
    return deleted;
  }

  // Regular member: only own entries
  const result = await db
    .delete(wasteLog)
    .where(and(eq(wasteLog.wasteLogId, wasteLogId), eq(wasteLog.userId, userId)))
    .returning({ id: wasteLog.wasteLogId });

  const deleted = result.length > 0;
  if (deleted) {
    logger.info({ wasteLogId, userId }, "Waste entry deleted");
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// getWasteSummary
// ---------------------------------------------------------------------------

export async function getWasteSummary(
  userId: number,
  startDate: string,
  endDate: string,
  teamView?: boolean,
): Promise<WasteSummary> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgIds.length > 0
      ? inArray(wasteLog.userId, orgCtx.orgMemberUserIds)
      : eq(wasteLog.userId, userId);
  } else {
    userFilter = eq(wasteLog.userId, userId);
  }

  const conditions = and(
    userFilter,
    gte(wasteLog.loggedAt, new Date(startDate)),
    lte(wasteLog.loggedAt, new Date(endDate)),
  );

  // Run all aggregation queries in parallel
  const [totals, topByCost, topByWeight, byReason, dailyTrend] = await Promise.all([
    // Totals
    db
      .select({
        totalWeight: sql<string>`coalesce(sum(${wasteLog.quantity}), 0)`,
        totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
        totalEntries: sql<number>`count(*)::int`,
      })
      .from(wasteLog)
      .where(conditions),

    // Top 5 by cost
    db
      .select({
        ingredientName: wasteLog.ingredientName,
        totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
      })
      .from(wasteLog)
      .where(conditions)
      .groupBy(wasteLog.ingredientName)
      .orderBy(sql`sum(${wasteLog.estimatedCost}) desc nulls last`)
      .limit(5),

    // Top 5 by weight
    db
      .select({
        ingredientName: wasteLog.ingredientName,
        totalWeight: sql<string>`coalesce(sum(${wasteLog.quantity}), 0)`,
        unit: sql<string>`mode() within group (order by ${wasteLog.unit})`,
      })
      .from(wasteLog)
      .where(conditions)
      .groupBy(wasteLog.ingredientName)
      .orderBy(sql`sum(${wasteLog.quantity}) desc`)
      .limit(5),

    // Breakdown by reason
    db
      .select({
        reason: sql<string>`coalesce(${wasteLog.reason}, 'unspecified')`,
        count: sql<number>`count(*)::int`,
        totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
      })
      .from(wasteLog)
      .where(conditions)
      .groupBy(wasteLog.reason)
      .orderBy(sql`count(*) desc`),

    // Daily trend
    db
      .select({
        date: sql<string>`to_char(${wasteLog.loggedAt}::date, 'YYYY-MM-DD')`,
        entries: sql<number>`count(*)::int`,
        totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
        totalWeight: sql<string>`coalesce(sum(${wasteLog.quantity}), 0)`,
      })
      .from(wasteLog)
      .where(conditions)
      .groupBy(sql`${wasteLog.loggedAt}::date`)
      .orderBy(sql`${wasteLog.loggedAt}::date asc`),
  ]);

  const t = totals[0];

  return {
    totalWeight: Number(t?.totalWeight ?? 0),
    totalCost: Number(t?.totalCost ?? 0),
    totalEntries: Number(t?.totalEntries ?? 0),
    topByCost: topByCost.map((r) => ({
      name: r.ingredientName,
      cost: Number(r.totalCost),
    })),
    topByWeight: topByWeight.map((r) => ({
      name: r.ingredientName,
      weight: Number(r.totalWeight),
      unit: r.unit,
    })),
    byReason: byReason.map((r) => ({
      reason: r.reason,
      count: Number(r.count),
      cost: Number(r.totalCost),
    })),
    dailyTotals: dailyTrend.map((r) => ({
      date: r.date,
      weight: Number(r.totalWeight),
      cost: Number(r.totalCost),
    })),
  };
}

// ---------------------------------------------------------------------------
// getIngredientSuggestions
// ---------------------------------------------------------------------------

export async function getIngredientSuggestions(
  userId: number,
  query: string,
): Promise<string[]> {
  const pattern = `%${query.trim()}%`;

  // If user has an org, search across all org members' logs
  const orgCtx = await getUserOrgContext(userId);
  const wasteUserFilter = orgCtx.orgIds.length > 0
    ? inArray(wasteLog.userId, orgCtx.orgMemberUserIds)
    : eq(wasteLog.userId, userId);

  // Search waste_log ingredient names (recent, distinct)
  const wasteNames = db
    .selectDistinct({ name: wasteLog.ingredientName })
    .from(wasteLog)
    .where(and(wasteUserFilter, ilike(wasteLog.ingredientName, pattern)))
    .orderBy(desc(wasteLog.loggedAt))
    .limit(10);

  // Search recipe JSONB ingredients
  const recipeNames = db
    .select({
      name: sql<string>`jsonb_array_elements(${recipe.recipeData} -> 'ingredients') ->> 'name'`,
    })
    .from(recipe)
    .where(
      and(
        eq(recipe.userId, userId),
        sql`jsonb_array_elements(${recipe.recipeData} -> 'ingredients') ->> 'name' ILIKE ${pattern}`,
      ),
    )
    .limit(10);

  const [wasteResults, recipeResults] = await Promise.all([wasteNames, recipeNames]);

  // Merge and deduplicate (case-insensitive)
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const r of [...wasteResults, ...recipeResults]) {
    const lower = r.name?.toLowerCase();
    if (lower && !seen.has(lower)) {
      seen.add(lower);
      suggestions.push(r.name);
    }
    if (suggestions.length >= 15) break;
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// generateReuseSuggestions
// ---------------------------------------------------------------------------

const ReuseSuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      ingredientName: z.string(),
      quantityWasted: z.number(),
      suggestion: z.string(),
      type: z.enum(["recipe", "stock", "special", "staff_meal"]),
    }),
  ),
});

export async function generateReuseSuggestions(
  userId: number,
): Promise<ReuseSuggestion[]> {
  // Get last 7 days of waste, grouped by ingredient
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const grouped = await db
    .select({
      ingredientName: wasteLog.ingredientName,
      totalQuantity: sql<string>`sum(${wasteLog.quantity})`,
      unit: wasteLog.unit,
      totalCost: sql<string>`coalesce(sum(${wasteLog.estimatedCost}), 0)`,
      topReason: sql<string>`mode() within group (order by ${wasteLog.reason})`,
    })
    .from(wasteLog)
    .where(
      and(
        eq(wasteLog.userId, userId),
        gte(wasteLog.loggedAt, sevenDaysAgo),
      ),
    )
    .groupBy(wasteLog.ingredientName, wasteLog.unit)
    .orderBy(sql`sum(${wasteLog.estimatedCost}) desc nulls last`)
    .limit(10);

  if (grouped.length === 0) {
    logger.info({ userId }, "No waste data in last 7 days for reuse suggestions");
    return [];
  }

  const wasteDescription = grouped
    .map(
      (g) =>
        `- ${g.ingredientName}: ${Number(g.totalQuantity)} ${g.unit} wasted (cost: $${Number(g.totalCost).toFixed(2)}, main reason: ${g.topReason ?? "unspecified"})`,
    )
    .join("\n");

  const model = getModel();

  try {
    const { object } = await generateObject({
      model,
      schema: ReuseSuggestionSchema,
      system:
        "You are a professional kitchen waste reduction consultant. " +
        "Given a list of recently wasted ingredients, suggest practical ways to reuse or repurpose " +
        "these ingredients before they become waste. Focus on real culinary techniques: stocks, " +
        "sauces, staff meals, ferments, garnishes, etc. Be specific and actionable.",
      prompt:
        `Here are the top wasted ingredients from the last 7 days:\n\n${wasteDescription}\n\n` +
        "For each ingredient, provide a practical reuse suggestion, a potential dish, and estimated savings.",
    });

    logger.info(
      { userId, suggestionCount: object.suggestions.length },
      "AI reuse suggestions generated",
    );

    return object.suggestions.map((s) => ({
      id: crypto.randomUUID(),
      ingredientName: s.ingredientName,
      quantityWasted: Number(s.quantityWasted),
      suggestion: s.suggestion,
      type: s.type,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ userId, error: msg }, "Failed to generate reuse suggestions");
    throw new Error("Failed to generate reuse suggestions. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// editWasteLog
// ---------------------------------------------------------------------------

export interface WasteLogUpdate {
  ingredientName?: string;
  quantity?: number;
  unit?: string;
  estimatedCost?: number | null;
  reason?: string | null;
  notes?: string | null;
  shift?: string | null;
}

export async function editWasteLog(
  wasteLogId: string,
  userId: number,
  data: WasteLogUpdate,
  orgCtx?: OrgContext,
): Promise<WasteLogRow | null> {
  // Build partial update object — only include provided fields
  const updates: Record<string, unknown> = {};
  if (data.ingredientName !== undefined) updates.ingredientName = data.ingredientName.trim();
  if (data.quantity !== undefined) updates.quantity = String(data.quantity);
  if (data.unit !== undefined) updates.unit = data.unit.trim();
  if (data.estimatedCost !== undefined)
    updates.estimatedCost = data.estimatedCost != null ? String(data.estimatedCost) : null;
  if (data.reason !== undefined) updates.reason = data.reason;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.shift !== undefined) updates.shift = data.shift;

  // Determine ownership filter: org admin can edit any org member's entries
  const ownerFilter = orgCtx?.isOrgAdmin && orgCtx.orgIds.length > 0
    ? and(eq(wasteLog.wasteLogId, wasteLogId), inArray(wasteLog.userId, orgCtx.orgMemberUserIds))
    : and(eq(wasteLog.wasteLogId, wasteLogId), eq(wasteLog.userId, userId));

  if (Object.keys(updates).length === 0) {
    // Nothing to update — just return the existing row
    const [existing] = await db
      .select()
      .from(wasteLog)
      .where(ownerFilter);
    return existing ? toRow(existing) : null;
  }

  updates.updatedDttm = new Date();

  const result = await db
    .update(wasteLog)
    .set(updates)
    .where(ownerFilter)
    .returning();

  if (result.length === 0) {
    return null;
  }

  logger.info({ wasteLogId, userId, orgAdmin: orgCtx?.isOrgAdmin }, "Waste entry updated");
  return toRow(result[0]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRow(r: typeof wasteLog.$inferSelect): WasteLogRow {
  return {
    wasteLogId: r.wasteLogId,
    userId: r.userId,
    ingredientName: r.ingredientName,
    quantity: Number(r.quantity),
    unit: r.unit,
    estimatedCost: r.estimatedCost != null ? Number(r.estimatedCost) : null,
    reason: r.reason,
    notes: r.notes,
    shift: r.shift,
    loggedAt: r.loggedAt.toISOString(),
    createdDttm: r.createdDttm.toISOString(),
  };
}
