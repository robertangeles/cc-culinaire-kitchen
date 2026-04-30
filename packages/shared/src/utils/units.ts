/**
 * @module utils/units
 *
 * Unit conversion utility for the catalog-spine cost flow.
 *
 * Why this exists: `menu_item_ingredient.quantity` may be entered in any
 * unit (e.g. 50g of butter), but `ingredient.preferred_unit_cost` is priced
 * per `ingredient.base_unit` (e.g. $12.40 / kg). Cost calculation needs a
 * deterministic conversion to the base unit. Identifying the wrong unit
 * silently inflates or deflates food cost by orders of magnitude — strict
 * conversion + an explicit error on incompatible units is the correct posture.
 *
 * Out of scope: density-based conversion (volume ↔ mass requires per-ingredient
 * density). If a recipe asks for "1 cup of flour", the picker forces the chef
 * to either pick a mass-based recipe row or store flour with `base_unit = cup`.
 *
 * In scope:
 *   - mass:   mg ↔ g ↔ kg
 *   - volume: ml ↔ L ↔ tsp ↔ tbsp ↔ cup ↔ floz
 *   - count:  each, dozen (= 12 each), portion (= 1 each, app-internal alias)
 *   - identity: any unit converts to itself with factor 1
 */

/** Canonical lower-case unit tokens. Match the dropdown in MenuItemFormModal. */
export type BaseUnit = "mg" | "g" | "kg" | "ml" | "l" | "tsp" | "tbsp" | "cup" | "floz" | "each" | "dozen" | "portion";

/** Family groups — units only convert losslessly within their own family. */
const MASS: ReadonlySet<BaseUnit> = new Set(["mg", "g", "kg"]);
const VOLUME: ReadonlySet<BaseUnit> = new Set(["ml", "l", "tsp", "tbsp", "cup", "floz"]);
const COUNT: ReadonlySet<BaseUnit> = new Set(["each", "dozen", "portion"]);

/**
 * Conversion factor: how many of THIS unit equal one base reference unit
 * within the family. Keys are unit names; values are the multiplier used to
 * convert FROM that unit TO the family's reference unit.
 *
 *   Mass family reference  : grams (g)
 *   Volume family reference: millilitres (ml)
 *   Count family reference : each
 */
const TO_REFERENCE: Record<BaseUnit, number> = {
  // mass → g
  mg: 0.001,
  g: 1,
  kg: 1000,

  // volume → ml
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  cup: 236.588,
  floz: 29.5735,

  // count → each
  each: 1,
  dozen: 12,
  portion: 1,
};

function familyOf(unit: BaseUnit): "mass" | "volume" | "count" {
  if (MASS.has(unit)) return "mass";
  if (VOLUME.has(unit)) return "volume";
  if (COUNT.has(unit)) return "count";
  // unreachable when input passes the BaseUnit type guard
  throw new IncompatibleUnitsError(`Unknown unit family for "${unit}"`);
}

export class IncompatibleUnitsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleUnitsError";
  }
}

/** Normalize a user-entered unit string to a {@link BaseUnit}. Returns null
 *  when the string isn't a recognised unit. */
export function normalizeUnit(raw: string): BaseUnit | null {
  const v = raw.trim().toLowerCase();
  switch (v) {
    case "mg":
    case "milligram":
    case "milligrams":
      return "mg";
    case "g":
    case "gram":
    case "grams":
      return "g";
    case "kg":
    case "kilogram":
    case "kilograms":
      return "kg";
    case "ml":
    case "millilitre":
    case "millilitres":
    case "milliliter":
    case "milliliters":
      return "ml";
    case "l":
    case "litre":
    case "litres":
    case "liter":
    case "liters":
      return "l";
    case "tsp":
    case "teaspoon":
    case "teaspoons":
      return "tsp";
    case "tbsp":
    case "tablespoon":
    case "tablespoons":
      return "tbsp";
    case "cup":
    case "cups":
      return "cup";
    case "floz":
    case "fl oz":
    case "fluid ounce":
    case "fluid ounces":
      return "floz";
    case "each":
    case "ea":
    case "unit":
    case "units":
      return "each";
    case "dozen":
    case "dz":
      return "dozen";
    case "portion":
    case "serving":
    case "servings":
      return "portion";
    default:
      return null;
  }
}

/**
 * Convert `quantity` from `fromUnit` to `toUnit`. Both units must belong to
 * the same family. Throws {@link IncompatibleUnitsError} on cross-family
 * conversion (e.g. kg → ml).
 *
 * Same unit on both sides returns the input unchanged (factor 1).
 *
 * @example
 *   convertUnit(50, "g", "kg")  // 0.05
 *   convertUnit(0.5, "kg", "g") // 500
 *   convertUnit(2, "tbsp", "tsp") // 6.000... ≈ 3*2
 *   convertUnit(1, "kg", "ml")  // throws IncompatibleUnitsError
 */
export function convertUnit(quantity: number, fromUnit: BaseUnit, toUnit: BaseUnit): number {
  if (fromUnit === toUnit) return quantity;

  const fromFamily = familyOf(fromUnit);
  const toFamily = familyOf(toUnit);
  if (fromFamily !== toFamily) {
    throw new IncompatibleUnitsError(
      `Cannot convert ${quantity} ${fromUnit} → ${toUnit}: families differ (${fromFamily} vs ${toFamily}).`,
    );
  }

  // Convert via family reference: from→ref→to.
  const inReference = quantity * TO_REFERENCE[fromUnit];
  return inReference / TO_REFERENCE[toUnit];
}

/**
 * Convenience wrapper that converts a quantity to the catalog ingredient's
 * `base_unit`. Matches the cost-flow shape used by menuItemCostService:
 *
 *   line cost = convertToBaseUnit(qty, unit, ingredient.base_unit) * preferred_unit_cost
 */
export function convertToBaseUnit(
  quantity: number,
  fromUnit: BaseUnit,
  baseUnit: BaseUnit,
): number {
  return convertUnit(quantity, fromUnit, baseUnit);
}

/**
 * Return the list of units that convert losslessly to {@link baseUnit}.
 * Used by IngredientPicker to filter the dropdown so a chef editing an
 * ingredient with `base_unit = kg` doesn't see "ml" / "tsp" as valid choices.
 */
export function unitsCompatibleWith(baseUnit: BaseUnit): BaseUnit[] {
  const family = familyOf(baseUnit);
  if (family === "mass") return ["mg", "g", "kg"];
  if (family === "volume") return ["ml", "l", "tsp", "tbsp", "cup", "floz"];
  return ["each", "dozen", "portion"];
}
