/**
 * @module services/ingredientService
 *
 * CRUD operations for the org-wide ingredient catalog and
 * per-location ingredient configuration (par levels, unit overrides).
 */

import { eq, and, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient,
  locationIngredient,
  unitConversion,
  stockLevel,
} from "../db/schema.js";

// ─── Org-wide ingredient catalog ──────────────────────────────────

/** Create a new ingredient in the org catalog. */
export async function createIngredient(
  organisationId: number,
  data: {
    ingredientName: string;
    ingredientCategory: string;
    baseUnit: string;
  },
) {
  const [row] = await db
    .insert(ingredient)
    .values({
      organisationId,
      ingredientName: data.ingredientName.trim(),
      ingredientCategory: data.ingredientCategory,
      baseUnit: data.baseUnit,
    })
    .returning();
  return row;
}

/** List all ingredients for an organisation, optionally filtered by category. */
export async function listIngredients(
  organisationId: number,
  opts?: { category?: string; search?: string },
) {
  let query = db
    .select()
    .from(ingredient)
    .where(eq(ingredient.organisationId, organisationId))
    .$dynamic();

  if (opts?.category) {
    query = query.where(
      and(
        eq(ingredient.organisationId, organisationId),
        eq(ingredient.ingredientCategory, opts.category),
      ),
    );
  }

  if (opts?.search) {
    query = query.where(
      and(
        eq(ingredient.organisationId, organisationId),
        ilike(ingredient.ingredientName, `%${opts.search}%`),
      ),
    );
  }

  return query;
}

/** Get a single ingredient by ID (with org guard). */
export async function getIngredient(ingredientId: string, organisationId: number) {
  const rows = await db
    .select()
    .from(ingredient)
    .where(
      and(
        eq(ingredient.ingredientId, ingredientId),
        eq(ingredient.organisationId, organisationId),
      ),
    );
  return rows[0] ?? null;
}

/** Update an ingredient's name, category, or base unit. */
export async function updateIngredient(
  ingredientId: string,
  organisationId: number,
  data: Partial<{
    ingredientName: string;
    ingredientCategory: string;
    baseUnit: string;
  }>,
) {
  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.ingredientName !== undefined) updates.ingredientName = data.ingredientName.trim();
  if (data.ingredientCategory !== undefined) updates.ingredientCategory = data.ingredientCategory;
  if (data.baseUnit !== undefined) updates.baseUnit = data.baseUnit;

  const [row] = await db
    .update(ingredient)
    .set(updates)
    .where(
      and(
        eq(ingredient.ingredientId, ingredientId),
        eq(ingredient.organisationId, organisationId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─── Per-location ingredient config ───────────────────────────────

/** Get or create a location_ingredient record. */
export async function getOrCreateLocationIngredient(
  ingredientId: string,
  storeLocationId: string,
) {
  const existing = await db
    .select()
    .from(locationIngredient)
    .where(
      and(
        eq(locationIngredient.ingredientId, ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    );

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(locationIngredient)
    .values({ ingredientId, storeLocationId })
    .returning();
  return row;
}

/** List all ingredients for a location with their overrides. */
export async function listLocationIngredients(
  storeLocationId: string,
  organisationId: number,
) {
  // Left join: all org ingredients + any location-specific overrides
  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      // Location overrides (nullable)
      locationIngredientId: locationIngredient.locationIngredientId,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
      unitOverride: locationIngredient.unitOverride,
      categoryOverride: locationIngredient.categoryOverride,
      activeInd: locationIngredient.activeInd,
      // Current stock
      currentQty: stockLevel.currentQty,
      lastCountedDttm: stockLevel.lastCountedDttm,
    })
    .from(ingredient)
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, ingredient.ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    )
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.ingredientId, ingredient.ingredientId),
        eq(stockLevel.storeLocationId, storeLocationId),
      ),
    )
    .where(eq(ingredient.organisationId, organisationId));

  return rows;
}

/** Update location-specific ingredient config (par level, unit override, etc.). */
export async function updateLocationIngredient(
  ingredientId: string,
  storeLocationId: string,
  data: Partial<{
    parLevel: string;
    reorderQty: string;
    unitOverride: string | null;
    categoryOverride: string | null;
    activeInd: boolean;
  }>,
) {
  // Ensure record exists first
  await getOrCreateLocationIngredient(ingredientId, storeLocationId);

  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.parLevel !== undefined) updates.parLevel = data.parLevel;
  if (data.reorderQty !== undefined) updates.reorderQty = data.reorderQty;
  if (data.unitOverride !== undefined) updates.unitOverride = data.unitOverride;
  if (data.categoryOverride !== undefined) updates.categoryOverride = data.categoryOverride;
  if (data.activeInd !== undefined) updates.activeInd = data.activeInd;

  const [row] = await db
    .update(locationIngredient)
    .set(updates)
    .where(
      and(
        eq(locationIngredient.ingredientId, ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─── Unit conversions ─────────────────────────────────────────────

/** Add a unit conversion for an ingredient (e.g., 1 case = 12 each). */
export async function addUnitConversion(
  ingredientId: string,
  fromUnit: string,
  toBaseFactor: string,
) {
  const [row] = await db
    .insert(unitConversion)
    .values({ ingredientId, fromUnit, toBaseFactor })
    .returning();
  return row;
}

/** List all unit conversions for an ingredient. */
export async function listUnitConversions(ingredientId: string) {
  return db
    .select()
    .from(unitConversion)
    .where(eq(unitConversion.ingredientId, ingredientId));
}

/** Delete a unit conversion. */
export async function deleteUnitConversion(conversionId: string) {
  const [row] = await db
    .delete(unitConversion)
    .where(eq(unitConversion.conversionId, conversionId))
    .returning();
  return row ?? null;
}
