/**
 * @module services/menuIntelligenceService
 *
 * Menu engineering calculation engine + CRUD for menu items.
 * Implements the Star/Plowhorse/Puzzle/Dog classification matrix.
 *
 * Formulas:
 *   line_cost = (quantity × unit_cost) / (yield_pct / 100)
 *   food_cost = Σ line_cost for all ingredients
 *   food_cost_pct = (food_cost / selling_price) × 100
 *   contribution_margin = selling_price - food_cost
 *   menu_mix_pct = (units_sold / total_units_sold) × 100
 *
 * Classification:
 *   Star      = CM ≥ avg AND mix ≥ avg
 *   Plowhorse = CM < avg AND mix ≥ avg
 *   Puzzle    = CM ≥ avg AND mix < avg
 *   Dog       = CM < avg AND mix < avg
 */

import pino from "pino";
import { db } from "../db/index.js";
import { menuItem, menuItemIngredient, menuCategorySetting, wasteLog, ingredient } from "../db/schema.js";
import { eq, and, sql, desc, gte, ilike, inArray } from "drizzle-orm";
import { convertToBaseUnit, normalizeUnit, type BaseUnit, IncompatibleUnitsError } from "@culinaire/shared";

const logger = pino({ name: "menuIntelligence" });

// ---------------------------------------------------------------------------
// Menu Item CRUD
// ---------------------------------------------------------------------------

export async function createMenuItem(userId: number, data: {
  name: string;
  category: string;
  sellingPrice: string;
}) {
  const [item] = await db.insert(menuItem).values({
    userId,
    name: data.name,
    category: data.category,
    sellingPrice: data.sellingPrice,
  }).returning();
  return item;
}

export async function getMenuItems(userId: number, category?: string, storeLocationId?: string) {
  const conditions = [eq(menuItem.userId, userId)];
  if (category) conditions.push(eq(menuItem.category, category));
  if (storeLocationId) conditions.push(eq(menuItem.storeLocationId, storeLocationId));

  return db.select().from(menuItem)
    .where(and(...conditions))
    .orderBy(menuItem.category, menuItem.name);
}

export async function getMenuItem(menuItemId: string, userId: number) {
  const [item] = await db.select().from(menuItem)
    .where(and(eq(menuItem.menuItemId, menuItemId), eq(menuItem.userId, userId)))
    .limit(1);
  return item ?? null;
}

export async function updateMenuItem(menuItemId: string, userId: number, data: Partial<{
  name: string;
  category: string;
  sellingPrice: string;
  unitsSold: number;
  periodStart: string;
  periodEnd: string;
}>) {
  const setValues: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.name !== undefined) setValues.name = data.name;
  if (data.category !== undefined) setValues.category = data.category;
  if (data.sellingPrice !== undefined) setValues.sellingPrice = data.sellingPrice;
  if (data.unitsSold !== undefined) setValues.unitsSold = data.unitsSold;
  if (data.periodStart !== undefined) setValues.periodStart = data.periodStart;
  if (data.periodEnd !== undefined) setValues.periodEnd = data.periodEnd;

  await db.update(menuItem).set(setValues)
    .where(and(eq(menuItem.menuItemId, menuItemId), eq(menuItem.userId, userId)));
}

export async function deleteMenuItem(menuItemId: string, userId: number) {
  await db.delete(menuItem)
    .where(and(eq(menuItem.menuItemId, menuItemId), eq(menuItem.userId, userId)));
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
async function resolveUnitCost(
  callerUnitCost: string | null | undefined,
  ingredientId: string | null | undefined,
): Promise<string> {
  if (callerUnitCost !== undefined && callerUnitCost !== null && callerUnitCost !== "") {
    return callerUnitCost;
  }
  if (!ingredientId) return "0";
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
 * line_cost = (qtyInBaseUnit × unitCost) / (yieldPct / 100)
 *
 * Quantity is converted to the ingredient's base unit before multiplication.
 * If `ingredientId` is null (legacy free-text row) or no unit conversion is
 * possible, qty is used as-is and we trust the caller's unit/cost.
 */
async function computeLineCost(
  quantity: string,
  unit: string,
  unitCost: string,
  yieldPct: string,
  ingredientId: string | null | undefined,
): Promise<string> {
  const qty = parseFloat(quantity);
  const cost = parseFloat(unitCost);
  const yld = parseFloat(yieldPct);
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || !Number.isFinite(yld) || yld === 0) {
    return "0.00";
  }

  let qtyInBase = qty;
  if (ingredientId) {
    const [ing] = await db
      .select({ baseUnit: ingredient.baseUnit })
      .from(ingredient)
      .where(eq(ingredient.ingredientId, ingredientId));
    const fromUnit = normalizeUnit(unit);
    const toUnit = ing?.baseUnit ? normalizeUnit(ing.baseUnit) : null;
    if (fromUnit && toUnit) {
      try {
        qtyInBase = convertToBaseUnit(qty, fromUnit as BaseUnit, toUnit as BaseUnit);
      } catch (err) {
        if (err instanceof IncompatibleUnitsError) {
          // Surface the error: cost would be silently wrong otherwise.
          logger.warn({ ingredientId, fromUnit, toUnit, err: err.message }, "Unit conversion failed in computeLineCost");
          throw err;
        }
        throw err;
      }
    }
  }

  return ((qtyInBase * cost) / (yld / 100)).toFixed(2);
}

export async function addIngredient(menuItemId: string, data: {
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
  return ing;
}

export async function getIngredients(menuItemId: string) {
  return db.select().from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId))
    .orderBy(menuItemIngredient.ingredientName);
}

export async function deleteIngredient(ingredientId: number, menuItemId: string) {
  await db.delete(menuItemIngredient)
    .where(and(eq(menuItemIngredient.id, ingredientId), eq(menuItemIngredient.menuItemId, menuItemId)));
  await recalculateItemCosts(menuItemId);
}

// ---------------------------------------------------------------------------
// Cost Calculation
// ---------------------------------------------------------------------------

async function recalculateItemCosts(menuItemId: string) {
  const ingredients = await db.select().from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId));

  const foodCost = ingredients.reduce((sum, ing) => sum + parseFloat(ing.lineCost ?? "0"), 0);

  const [item] = await db.select({ sellingPrice: menuItem.sellingPrice })
    .from(menuItem).where(eq(menuItem.menuItemId, menuItemId)).limit(1);

  if (!item) return;

  const sellingPrice = parseFloat(item.sellingPrice);
  const foodCostPct = sellingPrice > 0 ? (foodCost / sellingPrice) * 100 : 0;
  const contributionMargin = sellingPrice - foodCost;

  await db.update(menuItem).set({
    foodCost: foodCost.toFixed(2),
    foodCostPct: foodCostPct.toFixed(2),
    contributionMargin: contributionMargin.toFixed(2),
    updatedDttm: new Date(),
  }).where(eq(menuItem.menuItemId, menuItemId));
}

// ---------------------------------------------------------------------------
// Classification Engine
// ---------------------------------------------------------------------------

export async function recalculateMenu(userId: number, category?: string) {
  const items = await getMenuItems(userId, category);
  if (items.length === 0) return;

  // Recalculate costs for all items
  for (const item of items) {
    await recalculateItemCosts(item.menuItemId);
  }

  // Re-fetch after cost recalculation
  const updated = await getMenuItems(userId, category);

  // Calculate totals for menu mix
  const totalUnitsSold = updated.reduce((sum, i) => sum + i.unitsSold, 0);

  // Update menu mix percentages
  for (const item of updated) {
    const mixPct = totalUnitsSold > 0 ? (item.unitsSold / totalUnitsSold) * 100 : 0;
    await db.update(menuItem).set({
      menuMixPct: mixPct.toFixed(2),
    }).where(eq(menuItem.menuItemId, item.menuItemId));
  }

  // Re-fetch with mix percentages
  const withMix = await getMenuItems(userId, category);

  // Calculate averages
  const avgCM = withMix.reduce((sum, i) => sum + parseFloat(i.contributionMargin ?? "0"), 0) / withMix.length;
  const avgMix = withMix.reduce((sum, i) => sum + parseFloat(i.menuMixPct ?? "0"), 0) / withMix.length;

  // Classify
  for (const item of withMix) {
    const cm = parseFloat(item.contributionMargin ?? "0");
    const mix = parseFloat(item.menuMixPct ?? "0");

    let classification: string;
    if (item.unitsSold === 0) {
      classification = "unclassified";
    } else if (cm >= avgCM && mix >= avgMix) {
      classification = "star";
    } else if (cm < avgCM && mix >= avgMix) {
      classification = "plowhorse";
    } else if (cm >= avgCM && mix < avgMix) {
      classification = "puzzle";
    } else {
      classification = "dog";
    }

    await db.update(menuItem).set({
      classification,
      updatedDttm: new Date(),
    }).where(eq(menuItem.menuItemId, item.menuItemId));
  }

  logger.info({ userId, itemCount: withMix.length, avgCM: avgCM.toFixed(2), avgMix: avgMix.toFixed(2) }, "Menu recalculated");
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function getMenuAnalysis(userId: number, category?: string) {
  await recalculateMenu(userId, category);

  const items = await getMenuItems(userId, category);

  const totalItems = items.length;
  const classified = items.filter((i) => i.classification !== "unclassified");

  const stars = classified.filter((i) => i.classification === "star").length;
  const plowhorses = classified.filter((i) => i.classification === "plowhorse").length;
  const puzzles = classified.filter((i) => i.classification === "puzzle").length;
  const dogs = classified.filter((i) => i.classification === "dog").length;

  const avgFoodCostPct = totalItems > 0
    ? items.reduce((sum, i) => sum + parseFloat(i.foodCostPct ?? "0"), 0) / totalItems
    : 0;
  const avgContributionMargin = totalItems > 0
    ? items.reduce((sum, i) => sum + parseFloat(i.contributionMargin ?? "0"), 0) / totalItems
    : 0;

  const totalRevenue = items.reduce((sum, i) => sum + (parseFloat(i.sellingPrice) * i.unitsSold), 0);
  const totalFoodCost = items.reduce((sum, i) => sum + (parseFloat(i.foodCost ?? "0") * i.unitsSold), 0);

  return {
    totalItems,
    stars,
    plowhorses,
    puzzles,
    dogs,
    unclassified: totalItems - classified.length,
    avgFoodCostPct: avgFoodCostPct.toFixed(1),
    avgContributionMargin: avgContributionMargin.toFixed(2),
    totalRevenue: totalRevenue.toFixed(2),
    totalFoodCost: totalFoodCost.toFixed(2),
    overallFoodCostPct: totalRevenue > 0 ? ((totalFoodCost / totalRevenue) * 100).toFixed(1) : "0",
    items: items.map((i) => ({
      ...i,
      sellingPrice: parseFloat(i.sellingPrice),
      foodCost: parseFloat(i.foodCost ?? "0"),
      foodCostPct: parseFloat(i.foodCostPct ?? "0"),
      contributionMargin: parseFloat(i.contributionMargin ?? "0"),
      menuMixPct: parseFloat(i.menuMixPct ?? "0"),
    })),
  };
}

// ---------------------------------------------------------------------------
// Category Settings
// ---------------------------------------------------------------------------

export async function getCategorySettings(userId: number) {
  return db.select().from(menuCategorySetting)
    .where(eq(menuCategorySetting.userId, userId))
    .orderBy(menuCategorySetting.categoryName);
}

export async function upsertCategorySetting(userId: number, categoryName: string, targetFoodCostPct: string) {
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

export async function importCsvSalesData(userId: number, csvContent: string) {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { updated: 0, notFound: [] };

  const header = lines[0].toLowerCase();
  const nameIdx = header.split(",").findIndex((h) => h.trim().includes("name") || h.trim().includes("item"));
  const soldIdx = header.split(",").findIndex((h) => h.trim().includes("sold") || h.trim().includes("quantity") || h.trim().includes("units"));

  if (nameIdx === -1 || soldIdx === -1) {
    throw new Error("CSV must have columns for item name and units sold");
  }

  let updated = 0;
  const notFound: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const name = cols[nameIdx];
    const sold = parseInt(cols[soldIdx], 10);
    if (!name || isNaN(sold)) continue;

    // Find matching menu item by name (case-insensitive)
    const [match] = await db.select({ menuItemId: menuItem.menuItemId })
      .from(menuItem)
      .where(and(eq(menuItem.userId, userId), sql`LOWER(${menuItem.name}) = LOWER(${name})`))
      .limit(1);

    if (match) {
      await db.update(menuItem).set({ unitsSold: sold, updatedDttm: new Date() })
        .where(eq(menuItem.menuItemId, match.menuItemId));
      updated++;
    } else {
      notFound.push(name);
    }
  }

  // Recalculate after import
  await recalculateMenu(userId);

  return { updated, notFound };
}

// ---------------------------------------------------------------------------
// AI Recommendations
// ---------------------------------------------------------------------------

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./providerService.js";
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

export async function getItemRecommendations(menuItemId: string, userId: number): Promise<MenuRecommendation> {
  const item = await getMenuItem(menuItemId, userId);
  if (!item) throw new Error("Item not found");

  const ingredients = await getIngredients(menuItemId);
  const kitchenContext = await buildContextString(userId);

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

  try {
    const model = getModel();
    const { object } = await generateObject({
      model,
      schema: RecommendationSchema,
      prompt,
    });
    return object;
  } catch (err) {
    logger.error({ err, menuItemId }, "Failed to generate menu recommendations");
    // Return a basic recommendation on failure
    return {
      summary: `This item is classified as a ${item.classification}. Add ingredients to get detailed AI recommendations.`,
      actions: [{
        type: item.classification === "dog" ? "remove" : "protect",
        description: item.classification === "dog"
          ? "Consider removing this item or generating a replacement recipe"
          : "Review this item's performance and ingredients for optimisation opportunities",
      }],
    };
  }
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
 * from the last 30 days. Returns aggregated waste cost per menu item.
 */
export async function getWasteImpactForMenuItems(userId: number): Promise<WasteImpactResult[]> {
  const items = await getMenuItems(userId);
  if (items.length === 0) return [];

  // Get all ingredients for all menu items.
  // Use Drizzle's `inArray` rather than raw `= ANY(${jsArray})` — the raw
  // form serialises a single-element JS array as just the inner string,
  // which Postgres reads as a malformed uuid[] literal and 500s.
  const allItemIds = items.map((i) => i.menuItemId);
  const allIngredients = await db.select().from(menuItemIngredient)
    .where(inArray(menuItemIngredient.menuItemId, allItemIds));

  if (allIngredients.length === 0) return [];

  // Get unique ingredient names across all menu items
  const ingredientNames = [...new Set(allIngredients.map((i) => i.ingredientName.toLowerCase()))];

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
        eq(wasteLog.userId, userId),
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
