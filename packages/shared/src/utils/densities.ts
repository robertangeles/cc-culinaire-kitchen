/**
 * @module utils/densities
 *
 * Curated density library (g/mL) for common culinary liquids and pourables —
 * the industry-standard volume↔mass bridge. Pâtisserie weighs everything,
 * including liquids; costing systems cross that boundary with specific
 * gravity. `suggestDensity(name)` pattern-matches an ingredient name so a
 * newly created liquid gets an accurate default with zero operator setup
 * (editable in the catalog — a suggestion, never a silent override).
 *
 * Values are room-temperature approximations from standard food-science
 * references; ±1–2% is well inside costing tolerance.
 */

interface DensityEntry {
  /** Case-insensitive substrings matched against the ingredient name. */
  match: string[];
  /** g per mL. */
  density: number;
}

/** Ordered — first match wins, so put specific patterns before generic ones. */
const LIBRARY: DensityEntry[] = [
  // sweeteners & syrups (specific before generic "syrup"/"sugar")
  { match: ["honey"], density: 1.42 },
  { match: ["glucose", "corn syrup"], density: 1.43 },
  { match: ["golden syrup", "treacle"], density: 1.43 },
  { match: ["maple syrup"], density: 1.37 },
  { match: ["molasses"], density: 1.41 },
  { match: ["condensed milk"], density: 1.29 },
  { match: ["syrup"], density: 1.35 },

  // dairy & alternatives
  { match: ["buttermilk"], density: 1.03 },
  { match: ["evaporated milk"], density: 1.07 },
  { match: ["oat milk"], density: 1.02 },
  { match: ["almond milk"], density: 1.01 },
  { match: ["soy milk"], density: 1.02 },
  { match: ["coconut milk"], density: 0.97 },
  { match: ["coconut cream"], density: 1.0 },
  { match: ["milk"], density: 1.03 },
  // "ice cream" MUST precede the generic "cream" — first match wins.
  { match: ["ice cream", "gelato", "sorbet"], density: 0.55 },
  { match: ["thickened cream", "heavy cream", "double cream"], density: 1.01 },
  { match: ["cream"], density: 1.01 },
  { match: ["yoghurt", "yogurt"], density: 1.04 },

  // fats & oils
  { match: ["olive oil"], density: 0.91 },
  { match: ["canola oil", "vegetable oil", "sunflower oil", "grapeseed oil"], density: 0.92 },
  { match: ["oil"], density: 0.92 },
  { match: ["butter, melted", "melted butter", "ghee"], density: 0.91 },

  // eggs (liquid/pasteurised)
  { match: ["egg white"], density: 1.03 },
  { match: ["egg yolk"], density: 1.03 },
  { match: ["liquid egg", "whole egg"], density: 1.03 },

  // alcohol & wine
  { match: ["spirit", "vodka", "gin", "rum", "whisky", "brandy", "liqueur", "cassis"], density: 0.95 },
  { match: ["wine", "champagne", "prosecco", "chardonnay", "shiraz", "sauvignon"], density: 0.99 },
  { match: ["beer", "cider"], density: 1.01 },

  // flavourings
  { match: ["vanilla extract", "vanilla essence", "extract", "essence"], density: 1.05 },
  { match: ["rosewater", "orange blossom"], density: 1.0 },
  { match: ["food colour", "food coloring", "colouring"], density: 1.1 },

  // fruit & juices
  { match: ["puree", "purée", "coulis"], density: 1.08 },
  { match: ["juice"], density: 1.045 },
  { match: ["nectar"], density: 1.05 },

  // stocks, sauces, water
  { match: ["stock", "broth"], density: 1.0 },
  { match: ["soy sauce"], density: 1.16 },
  { match: ["fish sauce"], density: 1.2 },
  { match: ["vinegar"], density: 1.01 },
  { match: ["sparkling water", "spring water", "mineral water", "water"], density: 1.0 },
];

/**
 * Suggest a density (g/mL) for an ingredient name, or null when no pattern
 * matches. Callers treat this as a prefill, never a silent write.
 */
export function suggestDensity(ingredientName: string): number | null {
  const name = ingredientName.trim().toLowerCase();
  if (!name) return null;
  for (const entry of LIBRARY) {
    if (entry.match.some((m) => name.includes(m))) return entry.density;
  }
  return null;
}
