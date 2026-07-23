/**
 * @module utils/unitResolution
 *
 * THE 6-step unit resolver as a PURE function — the single source of truth for
 * converting a staff-entered quantity to an ingredient's KITCHEN unit
 * (`ingredient.base_unit`). The server's `unitConversionService` delegates its
 * math phase here (feeding DB rows); the recipe editor calls it directly
 * (feeding API-fetched rows). One implementation, one test suite, no drift —
 * the client used to hand-mirror only 3 of the 6 steps, which is how "$0 cost"
 * bugs shipped for units the server resolved fine.
 *
 * Resolution order (first match wins):
 *   1. entered unit == kitchen unit                → qty
 *   2. entered unit == purchase packaging label    → qty × pack_qty
 *      (skipped when pack_qty is null/0 — a label without a size can't convert)
 *   3. explicit unit_conversion row                → qty × factor
 *      (an operator-defined factor beats anything derived)
 *   4. content equivalence                         → convert to content_unit,
 *      then ÷ content_qty ("1 bottle contains 750 ml": 150 ml → 0.2 bottle)
 *   5. same-family standard conversion vs kitchen unit (kg → g)
 *   6. throw IncompatibleUnitsError — a setup error, never a guess
 */

import {
  convertUnit,
  normalizeUnit,
  unitsCompatibleWith,
  IncompatibleUnitsError,
} from "./units.js";

/** The ingredient fields resolution needs. Numeric fields accept the string
 *  form Drizzle/JSON deliver so both server rows and API rows fit unchanged. */
export interface ResolvableIngredient {
  baseUnit: string;
  purchaseUnit?: string | null;
  packQty?: string | number | null;
  contentQty?: string | number | null;
  contentUnit?: string | null;
  /** Density in g/mL — the industry-standard volume↔mass bridge (milk 1.03).
   *  When set, weighed entries resolve against volume-counted items and vice
   *  versa. Null keeps the resolver's historical cross-family behavior. */
  densityGPerMl?: string | number | null;
}

/** One operator-defined `unit_conversion` row (step 3). */
export interface CustomConversion {
  fromUnit: string;
  toBaseFactor: string | number;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Cross the mass↔volume boundary via density (g/mL). Returns null when the
 *  pair isn't a mass/volume combination (e.g. counts). */
function densityBridge(
  qty: number,
  from: import("./units.js").BaseUnit,
  to: import("./units.js").BaseUnit,
  density: number,
): number | null {
  // mass → volume target: qty → grams → mL (÷ density) → target
  try {
    const grams = convertUnit(qty, from, "g");
    return convertUnit(grams / density, "ml", to);
  } catch {
    /* not mass→volume — try the other direction */
  }
  // volume → mass target: qty → mL → grams (× density) → target
  try {
    const ml = convertUnit(qty, from, "ml");
    return convertUnit(ml * density, "g", to);
  } catch {
    return null;
  }
}

/**
 * Convert `qty` of `enteredUnit` into the ingredient's kitchen unit.
 * Throws {@link IncompatibleUnitsError} when no resolution path exists
 * (`opts.noPathMessage` lets the server keep its ingredient-specific wording).
 */
export function resolveQtyToKitchen(
  ing: ResolvableIngredient,
  qty: number,
  enteredUnit: string,
  conversions: CustomConversion[],
  opts?: { noPathMessage?: string },
): number {
  const entered = enteredUnit.trim().toLowerCase();
  const packQty = num(ing.packQty);
  const contentQty = num(ing.contentQty);

  // 1. Already in the kitchen unit.
  if (entered === ing.baseUnit.toLowerCase()) return qty;

  // 2. Purchase packaging label (case/bag): × kitchen units per package.
  if (ing.purchaseUnit && entered === ing.purchaseUnit.toLowerCase() && packQty && packQty > 0) {
    return qty * packQty;
  }

  // 3. Explicit per-ingredient conversion row (operator intent wins).
  for (const c of conversions) {
    if (c.fromUnit.trim().toLowerCase() === entered) {
      const factor = num(c.toBaseFactor);
      if (factor !== null) return qty * factor;
    }
  }

  const density = num(ing.densityGPerMl);

  // 4. Content equivalence: "1 kitchen unit contains content_qty content_unit".
  //    A measured entry (150 ml) against a counted item (bottle) divides down.
  //    With a density set, a WEIGHED entry bridges to a volume content unit
  //    (industry practice: pâtisserie weighs liquids — 780 g wine → 750 mL).
  if (contentQty && contentQty > 0 && ing.contentUnit) {
    const from = normalizeUnit(enteredUnit);
    const content = normalizeUnit(ing.contentUnit);
    if (from && content) {
      try {
        return convertUnit(qty, from, content) / contentQty;
      } catch {
        if (density && density > 0) {
          const bridged = densityBridge(qty, from, content, density);
          if (bridged !== null) return bridged / contentQty;
        }
        // different family than the content unit and no density — fall through
      }
    }
  }

  // 5. Same-family standard conversion straight to the kitchen unit (kg → g).
  //    5b. Density bridge: with density set, a mass entry resolves against a
  //    volume kitchen unit and vice versa (95 g milk → 0.0922 L @ 1.03 g/mL).
  //    Without density, a cross-family pair throws convertUnit's own
  //    IncompatibleUnitsError, exactly as the server always has.
  const from = normalizeUnit(enteredUnit);
  const base = normalizeUnit(ing.baseUnit);
  if (from && base) {
    try {
      return convertUnit(qty, from, base);
    } catch (err) {
      if (density && density > 0) {
        const bridged = densityBridge(qty, from, base, density);
        if (bridged !== null) return bridged;
      }
      throw err;
    }
  }

  // 6. No conversion path — a setup error, not a silent guess.
  throw new IncompatibleUnitsError(
    opts?.noPathMessage ??
      `Cannot convert "${enteredUnit}" to the kitchen unit "${ing.baseUnit}". ` +
        `Valid: ${resolvableUnits(ing, conversions).join(", ")}.`,
  );
}

/**
 * Every unit this ingredient can be entered in, for unit dropdowns — bounded
 * enumeration, no probing. Order: default unit (content unit when a content
 * equivalence exists, else kitchen unit), kitchen unit, purchase unit, custom
 * conversion units, content-unit family, base-unit family. When the kitchen
 * unit has no standard family (discrete counts like "bottle"), the fallback is
 * the kitchen unit itself. Every returned unit resolves via
 * {@link resolveQtyToKitchen} — the recipe editor's property test asserts it.
 */
export function resolvableUnits(
  ing: ResolvableIngredient,
  conversions: CustomConversion[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null | undefined) => {
    if (!u) return;
    const key = u.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };

  const packQty = num(ing.packQty);
  const contentQty = num(ing.contentQty);
  const hasContent = Boolean(contentQty && contentQty > 0 && ing.contentUnit && normalizeUnit(ing.contentUnit));

  // Default unit first: measured unit when content equivalence exists (pour
  // wine in mL even though it's counted in bottles), else the kitchen unit.
  add(hasContent ? ing.contentUnit : ing.baseUnit);
  add(ing.baseUnit);
  if (ing.purchaseUnit && packQty && packQty > 0) add(ing.purchaseUnit);
  for (const c of conversions) {
    if (num(c.toBaseFactor) !== null) add(c.fromUnit);
  }
  if (hasContent) {
    for (const u of unitsCompatibleWith(normalizeUnit(ing.contentUnit!)!)) add(u);
  }
  const base = normalizeUnit(ing.baseUnit);
  if (base) {
    for (const u of unitsCompatibleWith(base)) add(u);
  }

  // Density set → the mass↔volume counterpart family is resolvable too
  // (weigh milk in grams against a litre-counted item, or measure a weighed
  // syrup by the cup). Counts have no counterpart.
  if (num(ing.densityGPerMl)) {
    const counterpartOf = (u: ReturnType<typeof normalizeUnit>): string[] | null => {
      if (!u) return null;
      try { convertUnit(1, u, "g"); return unitsCompatibleWith("ml"); } catch { /* not mass */ }
      try { convertUnit(1, u, "ml"); return unitsCompatibleWith("g"); } catch { return null; }
    };
    for (const anchor of [base, hasContent ? normalizeUnit(ing.contentUnit!) : null]) {
      const others = counterpartOf(anchor);
      if (others) for (const u of others) add(u);
    }
  }
  return out;
}
