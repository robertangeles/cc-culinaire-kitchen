/**
 * @module services/unitConversionService
 *
 * THE unified unit resolver. Converts a staff-entered quantity to the
 * ingredient's KITCHEN unit (`ingredient.base_unit`) — the one fixed physical
 * unit the item is counted, stocked, and depleted in (flour: g, oil: ml,
 * eggs: each, wine: bottle). Every stock-moving flow (receiving, transfers,
 * consumption, stock take, recipe-based sales) resolves through here.
 *
 * Resolution order (first match wins):
 *   1. entered unit == kitchen unit                → qty
 *   2. entered unit == purchase packaging label    → qty × pack_qty
 *      (packaging exists ONLY at order/receive; converts here, at the boundary)
 *   3. explicit unit_conversion row                → qty × factor
 *      (an operator-defined factor beats anything derived)
 *   4. content equivalence                         → convert to content_unit,
 *      then ÷ content_qty ("1 bottle contains 750 ml": 150 ml → 0.2 bottle;
 *      divided at runtime so no repeating-decimal factor is ever stored)
 *   5. same-family standard conversion vs kitchen unit (kg → g)
 *   6. throw IncompatibleUnitsError — a setup error, never a guess
 */

import { eq } from "drizzle-orm";
import { normalizeUnit, resolveQtyToKitchen } from "@culinaire/shared";
import { db } from "../db/index.js";
import { unitConversion, ingredient } from "../db/schema.js";

interface UnitContext {
  baseUnit: string;
  purchaseUnit: string | null;
  packQty: number | null;
  contentQty: number | null;
  contentUnit: string | null;
  /** g/mL — enables the resolver's volume↔mass density bridge. */
  densityGPerMl: string | null;
}

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
    map.set(row.fromUnit.toLowerCase(), Number(row.toBaseFactor));
  }

  conversionCache.set(ingredientId, map);
  return map;
}

/** Invalidate the cache for an ingredient (call after adding/removing conversions). */
export function invalidateConversionCache(ingredientId: string): void {
  conversionCache.delete(ingredientId);
}

async function loadUnitContext(ingredientId: string): Promise<UnitContext> {
  const [ing] = await db
    .select({
      baseUnit: ingredient.baseUnit,
      purchaseUnit: ingredient.purchaseUnit,
      packQty: ingredient.packQty,
      contentQty: ingredient.contentQty,
      contentUnit: ingredient.contentUnit,
      densityGPerMl: ingredient.densityGPerMl,
    })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, ingredientId));
  if (!ing) throw new Error(`Ingredient not found: ${ingredientId}`);
  return {
    baseUnit: ing.baseUnit,
    purchaseUnit: ing.purchaseUnit,
    packQty: ing.packQty !== null ? Number(ing.packQty) : null,
    contentQty: ing.contentQty !== null ? Number(ing.contentQty) : null,
    contentUnit: ing.contentUnit,
    densityGPerMl: ing.densityGPerMl,
  };
}

/**
 * Convert a quantity from the entered unit to the ingredient's kitchen unit.
 * Returns { baseQty, baseUnit } or throws (see module doc for the order).
 */
export async function convertToBase(
  ingredientId: string,
  enteredQty: number,
  enteredUnit: string,
): Promise<{ baseQty: number; baseUnit: string }> {
  const ctx = await loadUnitContext(ingredientId);
  const conversions = await loadConversions(ingredientId);

  // Math phase delegates to the shared pure resolver (steps 1–6, same order) —
  // one implementation for server flows AND the recipe editor. The no-path
  // message keeps this service's original ingredient-specific wording.
  const baseQty = resolveQtyToKitchen(
    ctx,
    enteredQty,
    enteredUnit,
    [...conversions.entries()].map(([fromUnit, toBaseFactor]) => ({ fromUnit, toBaseFactor })),
    {
      noPathMessage:
        `Cannot convert "${enteredUnit}" to the kitchen unit "${ctx.baseUnit}" for ingredient ${ingredientId}. ` +
        `Set the item's packaging/content equivalence, or add a unit_conversion row for "${enteredUnit}". ` +
        `Valid: ${getValidUnitsFromContext(ctx, conversions).join(", ")}.`,
    },
  );
  return { baseQty, baseUnit: ctx.baseUnit };
}

/**
 * Canonical name for the unified resolver used by every stock-moving flow.
 * `convertToBase` remains as the original alias.
 */
export const resolveToBase = convertToBase;

function getValidUnitsFromContext(ctx: UnitContext, conversions: Map<string, number>): string[] {
  const units = new Set<string>([ctx.baseUnit]);
  if (ctx.purchaseUnit && ctx.packQty && ctx.packQty > 0) units.add(ctx.purchaseUnit);
  for (const u of conversions.keys()) units.add(u);
  if (ctx.contentQty && ctx.contentUnit && normalizeUnit(ctx.contentUnit)) units.add(ctx.contentUnit);
  return [...units];
}

/**
 * All units this ingredient can be entered in: kitchen unit, purchase package,
 * conversion-row units, and (when a content equivalence exists) the content
 * unit. Drives unit dropdowns (PO form, recipe lines, receiving).
 */
export async function getValidUnits(ingredientId: string): Promise<string[]> {
  const ctx = await loadUnitContext(ingredientId).catch(() => null);
  if (!ctx) return [];
  const conversions = await loadConversions(ingredientId);
  return getValidUnitsFromContext(ctx, conversions);
}
