/**
 * @module services/forecastService
 *
 * AI-powered stock forecasting. Analyses consumption patterns over
 * the last 30 days, calculates daily usage rates, predicts depletion
 * dates, and generates reorder recommendations.
 *
 * Confidence score scales linearly with available data:
 *   confidence = min(1, based_on_days / 30)
 */

import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  forecastRecommendation,
  consumptionLog,
  stockLevel,
  ingredient,
  ingredientSupplier,
  locationIngredient,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// 1. generateForecasts
// ---------------------------------------------------------------------------

export async function generateForecasts(locationId: string, orgId: number) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all active ingredients at this location
  const activeItems = await db
    .select({
      ingredientId: locationIngredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
    })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(locationIngredient.ingredientId, ingredient.ingredientId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, locationId),
        eq(locationIngredient.activeInd, true),
        eq(ingredient.organisationId, orgId),
      ),
    );

  if (activeItems.length === 0) return 0;

  // Aggregate consumption per ingredient for last 30 days
  const consumptionAgg = await db
    .select({
      ingredientId: consumptionLog.ingredientId,
      totalConsumed: sql<string>`coalesce(sum(${consumptionLog.quantity}), '0')`,
      dayCount: sql<number>`count(distinct date_trunc('day', ${consumptionLog.loggedAt}))::int`,
    })
    .from(consumptionLog)
    .where(
      and(
        eq(consumptionLog.storeLocationId, locationId),
        gte(consumptionLog.loggedAt, thirtyDaysAgo),
      ),
    )
    .groupBy(consumptionLog.ingredientId);

  const consumptionMap = new Map(
    consumptionAgg.map((c) => [c.ingredientId, c]),
  );

  // Get current stock levels
  const levels = await db
    .select({
      ingredientId: stockLevel.ingredientId,
      currentQty: stockLevel.currentQty,
    })
    .from(stockLevel)
    .where(eq(stockLevel.storeLocationId, locationId));

  const stockMap = new Map(levels.map((l) => [l.ingredientId, Number(l.currentQty)]));

  // Get preferred supplier lead times
  const supplierLeads = await db
    .select({
      ingredientId: ingredientSupplier.ingredientId,
      leadTimeDays: ingredientSupplier.leadTimeDays,
    })
    .from(ingredientSupplier)
    .where(eq(ingredientSupplier.preferredInd, true));

  const leadTimeMap = new Map(
    supplierLeads.map((s) => [s.ingredientId, s.leadTimeDays ?? 3]),
  );

  // Delete old ACTIVE recommendations for this location
  await db
    .delete(forecastRecommendation)
    .where(
      and(
        eq(forecastRecommendation.storeLocationId, locationId),
        eq(forecastRecommendation.status, "ACTIVE"),
      ),
    );

  let generatedCount = 0;

  for (const item of activeItems) {
    const consumption = consumptionMap.get(item.ingredientId);
    if (!consumption) continue; // no usage data

    const totalConsumed = Number(consumption.totalConsumed);
    if (totalConsumed <= 0) continue;

    const basedOnDays = consumption.dayCount;
    // Calculate elapsed calendar days for accurate daily rate
    const elapsedDays = Math.max(1, Math.ceil(
      (now.getTime() - thirtyDaysAgo.getTime()) / (24 * 60 * 60 * 1000),
    ));
    const dailyUsage = totalConsumed / elapsedDays;
    const currentStock = stockMap.get(item.ingredientId) ?? 0;
    const daysRemaining = dailyUsage > 0
      ? Math.floor(currentStock / dailyUsage)
      : 999;

    const leadTime = leadTimeMap.get(item.ingredientId) ?? 3;
    const buffer = 3;

    // Only create recommendation if depletion is within lead_time + buffer
    if (daysRemaining < leadTime + buffer) {
      const suggestedOrderQty = Math.ceil(dailyUsage * 14); // 2 weeks supply
      const confidence = Math.min(1, basedOnDays / 30);
      const predictedDepletionDate = new Date(
        now.getTime() + daysRemaining * 24 * 60 * 60 * 1000,
      );

      await db.insert(forecastRecommendation).values({
        organisationId: orgId,
        storeLocationId: locationId,
        ingredientId: item.ingredientId,
        predictedDepletionDate,
        daysRemaining: Math.max(0, daysRemaining),
        suggestedOrderQty: String(suggestedOrderQty),
        confidence: String(Number(confidence.toFixed(2))),
        basedOnDays,
        status: "ACTIVE",
      });

      generatedCount++;
    }
  }

  return generatedCount;
}

// ---------------------------------------------------------------------------
// 2. listRecommendations
// ---------------------------------------------------------------------------

export async function listRecommendations(
  locationId: string,
  opts?: { status?: string; limit?: number },
) {
  const conditions = [
    eq(forecastRecommendation.storeLocationId, locationId),
    eq(forecastRecommendation.status, opts?.status ?? "ACTIVE"),
  ];

  const rows = await db
    .select({
      recommendationId: forecastRecommendation.recommendationId,
      ingredientId: forecastRecommendation.ingredientId,
      predictedDepletionDate: forecastRecommendation.predictedDepletionDate,
      daysRemaining: forecastRecommendation.daysRemaining,
      suggestedOrderQty: forecastRecommendation.suggestedOrderQty,
      confidence: forecastRecommendation.confidence,
      basedOnDays: forecastRecommendation.basedOnDays,
      status: forecastRecommendation.status,
      createdDttm: forecastRecommendation.createdDttm,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      currentQty: stockLevel.currentQty,
    })
    .from(forecastRecommendation)
    .leftJoin(
      ingredient,
      eq(forecastRecommendation.ingredientId, ingredient.ingredientId),
    )
    .leftJoin(
      stockLevel,
      and(
        eq(forecastRecommendation.ingredientId, stockLevel.ingredientId),
        eq(forecastRecommendation.storeLocationId, stockLevel.storeLocationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(forecastRecommendation.daysRemaining)
    .limit(opts?.limit ?? 50);

  return rows;
}

// ---------------------------------------------------------------------------
// 3. dismissRecommendation
// ---------------------------------------------------------------------------

export async function dismissRecommendation(recId: string, orgId: number) {
  const [rec] = await db
    .select()
    .from(forecastRecommendation)
    .where(
      and(
        eq(forecastRecommendation.recommendationId, recId),
        eq(forecastRecommendation.organisationId, orgId),
      ),
    );

  if (!rec) throw new Error("Recommendation not found");

  const [updated] = await db
    .update(forecastRecommendation)
    .set({ status: "DISMISSED", updatedDttm: new Date() })
    .where(eq(forecastRecommendation.recommendationId, recId))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// 4. markOrdered
// ---------------------------------------------------------------------------

export async function markOrdered(recId: string, orgId: number, poId?: string) {
  const [rec] = await db
    .select()
    .from(forecastRecommendation)
    .where(
      and(
        eq(forecastRecommendation.recommendationId, recId),
        eq(forecastRecommendation.organisationId, orgId),
      ),
    );

  if (!rec) throw new Error("Recommendation not found");

  const [updated] = await db
    .update(forecastRecommendation)
    .set({ status: "ORDERED", updatedDttm: new Date() })
    .where(eq(forecastRecommendation.recommendationId, recId))
    .returning();

  return updated;
}
