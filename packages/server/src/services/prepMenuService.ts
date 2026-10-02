/**
 * @module services/prepMenuService
 * Menu planning domain: dish selection, suggestions, and high-impact analysis.
 */

import pino from "pino";
import { db } from "../db/index.js";
import {
  prepSession,
  prepMenuSelection,
  recipe,
  menuItem,
  menuItemIngredient,
} from "../db/schema.js";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { getUserOrgContext } from "./orgContextService.js";
import { computeSuggestedSelections } from "./prepMath.js";
import { PrepError, parseTimeToMinutes } from "./prepErrors.js";

const logger = pino({ name: "prepMenuService" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getMenuForSelection — returns dishes available for the chef to pick
// ---------------------------------------------------------------------------

/** Returns the list of menu items available for a chef to select for a prep session. */
export async function getMenuForSelection(
  userId: number,
  teamView?: boolean,
): Promise<MenuForSelection> {
  let userIds: number[];
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userIds = orgCtx.orgMemberUserIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
  } else {
    userIds = [userId];
  }

  const menuItems = await db
    .select()
    .from(menuItem)
    .where(inArray(menuItem.userId, userIds));

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
    userIds = orgCtx.orgMemberUserIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
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

/** Persists the chef's dish picks for a prep session. */
export async function saveMenuSelections(
  sessionId: string,
  userId: number,
  selections: MenuSelectionInput[],
): Promise<MenuSelectionRow[]> {
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

/** Returns the dish selections saved for a given prep session. */
export async function getSelections(
  sessionId: string,
  userId: number,
  teamView?: boolean,
): Promise<MenuSelectionRow[]> {
  let ownerFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    ownerFilter = orgCtx.orgMemberUserIds.length > 0
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
// getPreviousSelections — get most recent session's selections for quick re-use
// ---------------------------------------------------------------------------

/** Returns the most recent session's selections for quick re-use. */
export async function getPreviousSelections(
  userId: number,
  teamView?: boolean,
): Promise<MenuSelectionRow[]> {
  let userFilter;
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userFilter = orgCtx.orgMemberUserIds.length > 0
      ? inArray(prepSession.userId, orgCtx.orgMemberUserIds)
      : eq(prepSession.userId, userId);
  } else {
    userFilter = eq(prepSession.userId, userId);
  }

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
// getHighImpactDishes
// ---------------------------------------------------------------------------

/** Returns dishes with the highest prep impact based on ingredient volume. */
export async function getHighImpactDishes(
  userId: number,
  teamView?: boolean,
): Promise<HighImpactResult> {
  let userIds: number[];
  if (teamView) {
    const orgCtx = await getUserOrgContext(userId);
    userIds = orgCtx.orgMemberUserIds.length > 0 ? orgCtx.orgMemberUserIds : [userId];
  } else {
    userIds = [userId];
  }

  const menuItems = await db
    .select()
    .from(menuItem)
    .where(inArray(menuItem.userId, userIds));

  const hasMenuItems = menuItems.length > 0;

  if (hasMenuItems) {
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

  // ---- Recipe fallback path ----
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
// Helpers
// ---------------------------------------------------------------------------

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
