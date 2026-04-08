/**
 * @module services/unitConversionService
 *
 * Converts quantities between a staff-entered unit and the ingredient's
 * canonical base unit. Backed by the unit_conversion table.
 *
 * Conversion flow:
 *   Staff enters: 5 cases
 *   unit_conversion row: { from_unit: 'case', to_base_factor: 12 }
 *   Base qty = 5 × 12 = 60 each
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { unitConversion, ingredient } from "../db/schema.js";

/** In-memory cache: ingredientId → Map<fromUnit, factor>. Invalidated per-ingredient on write. */
const conversionCache = new Map<string, Map<string, number>>();

/** Load conversions for an ingredient into cache. */
async function loadConversions(ingredientId: string): Promise<Map<string, number>> {
  const cached = conversionCache.get(ingredientId);
  if (cached) return cached;

  const rows = await db
    .select()
    .from(unitConversion)
    .where(eq(unitConversion.ingredientId, ingredientId));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.fromUnit, Number(row.toBaseFactor));
  }

  conversionCache.set(ingredientId, map);
  return map;
}

/** Invalidate the cache for an ingredient (call after adding/removing conversions). */
export function invalidateConversionCache(ingredientId: string): void {
  conversionCache.delete(ingredientId);
}

/**
 * Convert a quantity from the entered unit to the ingredient's base unit.
 *
 * Returns { baseQty, baseUnit } or throws if the unit is unrecognised.
 *
 * If enteredUnit matches the ingredient's base_unit, no conversion is needed.
 */
export async function convertToBase(
  ingredientId: string,
  enteredQty: number,
  enteredUnit: string,
): Promise<{ baseQty: number; baseUnit: string }> {
  // Look up the ingredient to get its base unit
  const [ing] = await db
    .select({ baseUnit: ingredient.baseUnit })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, ingredientId));

  if (!ing) throw new Error(`Ingredient not found: ${ingredientId}`);

  // If the entered unit IS the base unit, no conversion needed
  if (enteredUnit.toLowerCase() === ing.baseUnit.toLowerCase()) {
    return { baseQty: enteredQty, baseUnit: ing.baseUnit };
  }

  // Look up conversion factor
  const conversions = await loadConversions(ingredientId);
  const factor = conversions.get(enteredUnit.toLowerCase()) ?? conversions.get(enteredUnit);

  if (factor === undefined) {
    throw new Error(
      `No conversion found for unit "${enteredUnit}" on ingredient ${ingredientId}. ` +
      `Valid units: ${ing.baseUnit} (base), ${[...conversions.keys()].join(", ")}`,
    );
  }

  return {
    baseQty: enteredQty * factor,
    baseUnit: ing.baseUnit,
  };
}

/**
 * Get all valid units for an ingredient (base unit + conversion units).
 */
export async function getValidUnits(ingredientId: string): Promise<string[]> {
  const [ing] = await db
    .select({ baseUnit: ingredient.baseUnit })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, ingredientId));

  if (!ing) return [];

  const conversions = await loadConversions(ingredientId);
  return [ing.baseUnit, ...conversions.keys()];
}
