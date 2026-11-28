/**
 * What the menu screens show, as pure functions. The cost rule lives here: a food cost, percentage or margin is what the server stored
 * (with the shared costing) and is shown only when the server sent it to someone who may see costs; nothing is worked out from what is left.
 */

import { DEFAULT_CATEGORY_TARGET_PCT, categoryActualFoodCostPct, matrixAverages, summariseMenuAnalysis } from "@culinaire/shared";
import type { MenuItem, MenuLine, YieldVariance } from "@culinaire/shared/schemas/menu";

export const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
export const pct = (n: number) => `${n.toFixed(1)}%`;

/** Up to three decimals, no trailing zeros: the precision of a recipe quantity. */
export const amount = (n: number) => String(Math.round(n * 1000) / 1000);

/** The item as someone without `inventory:cost` sees it. */
export const withoutCosts = (item: MenuItem): MenuItem => ({ ...item, foodCost: undefined, foodCostPct: undefined, contributionMargin: undefined });
export const lineWithoutCosts = (line: MenuLine): MenuLine => ({ ...line, unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined, costStaleInd: false });

export function costsOf(item: MenuItem): { foodCost: number; foodCostPct: number; margin: number } | null {
  const { foodCost, foodCostPct, contributionMargin } = item;
  if (typeof foodCost !== "number" || typeof foodCostPct !== "number" || typeof contributionMargin !== "number") return null;
  return { foodCost, foodCostPct, margin: contributionMargin };
}

/** The web's class names and sentences (MenuItemDetail.tsx). */
const CLASSES = {
  star: { label: "Star", sentence: "High profit, high popularity: protect this item." },
  plowhorse: { label: "Plowhorse", sentence: "High popularity but low profit: optimise costs or raise the price." },
  puzzle: { label: "Puzzle", sentence: "Good profit but low popularity: promote or reprice." },
  dog: { label: "Dog", sentence: "Low profit, low popularity: rework or replace." },
  unclassified: { label: "Unclassified", sentence: "Add sales to classify this item." },
} as const;

export const classInfo = (classification: string): { label: string; sentence: string } => CLASSES[classification as keyof typeof CLASSES] ?? CLASSES.unclassified;

/** The classes a list can be narrowed to, in the web's order. */
export const CLASS_FILTERS = ["star", "plowhorse", "puzzle", "dog"] as const;

export const categoriesOf = (items: MenuItem[]) => [...new Set(items.map((i) => i.category))].sort();

export function filterItems(items: MenuItem[], { query, category, klass }: { query: string; category: string | null; klass: string | null }): MenuItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((i) => (!category || i.category === category) && (!klass || i.classification === klass) && (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The category's target when the item is over it, else null. Only a target someone set counts, as in the web's table. */
export function overTarget(item: MenuItem, targets: Record<string, number>): number | null {
  const target = targets[item.category];
  return target !== undefined && typeof item.foodCostPct === "number" && item.foodCostPct > target ? target : null;
}

export interface CategoryRow {
  category: string;
  count: number;
  target: number;
  /** The average food cost % of its items, null when a cost is hidden. */
  actual: number | null;
  over: MenuItem[];
}

export function categoryRows(items: MenuItem[], targets: Record<string, number>): CategoryRow[] {
  return categoriesOf(items).map((category) => {
    const mine = items.filter((i) => i.category === category);
    const target = targets[category] ?? DEFAULT_CATEGORY_TARGET_PCT;
    const known = mine.flatMap((i) => (typeof i.foodCostPct === "number" ? [{ foodCostPct: i.foodCostPct }] : []));
    const actual = known.length === mine.length ? categoryActualFoodCostPct(known) : null;
    return { category, count: mine.length, target, actual, over: mine.filter((i) => typeof i.foodCostPct === "number" && i.foodCostPct > target) };
  });
}

const ALLERGENS = [
  ["containsDairyInd", "Dairy"],
  ["containsGlutenInd", "Gluten"],
  ["containsNutsInd", "Nuts"],
  ["containsShellfishInd", "Shellfish"],
  ["containsEggsInd", "Eggs"],
  ["isVegetarianInd", "Vegetarian"],
] as const;

export const allergensOf = (item: MenuItem): string[] => ALLERGENS.flatMap(([key, label]) => (item[key] ? [label] : []));

/** The web dashboard's four classes (MenuDashboard.tsx), in its order. */
export const QUADRANTS = [
  { key: "star", label: "Stars", sentence: "High profit, high popularity" },
  { key: "plowhorse", label: "Plowhorses", sentence: "Low profit, high popularity" },
  { key: "puzzle", label: "Puzzles", sentence: "High profit, low popularity" },
  { key: "dog", label: "Dogs", sentence: "Low profit, low popularity" },
] as const;

export interface Dashboard {
  totalItems: number;
  counts: Record<(typeof QUADRANTS)[number]["key"], number>;
  /** The averages over every item and the food cost weighted by units sold; null when costs are hidden. */
  costs: { avgFoodCostPct: number; avgMargin: number; overallFoodCostPct: number } | null;
  highestMargin: MenuItem | null;
  lowestMargin: MenuItem | null;
  mostPopular: MenuItem | null;
  leastPopular: MenuItem | null;
}

/**
 * The dashboard of the web's Menu & Costing page, from the items the server classified: the server's own `summariseMenuAnalysis`, over the
 * same items, a cost it stored as none counting 0 as it does there. The cost figures only when no cost is hidden.
 */
export function dashboardOf(items: MenuItem[]): Dashboard {
  const s = summariseMenuAnalysis(
    items.map((i) => ({ sellingPrice: i.sellingPrice, foodCost: i.foodCost ?? 0, foodCostPct: i.foodCostPct ?? 0, contributionMargin: i.contributionMargin ?? 0, unitsSold: i.unitsSold, classification: i.classification })),
  );
  const hidden = items.some((i) => i.foodCost === undefined || i.foodCostPct === undefined || i.contributionMargin === undefined);
  const byMargin = items.filter((i) => typeof i.contributionMargin === "number").sort((a, b) => b.contributionMargin! - a.contributionMargin!);
  const byMix = [...items].sort((a, b) => b.menuMixPct - a.menuMixPct);
  return {
    totalItems: s.totalItems,
    counts: { star: s.stars, plowhorse: s.plowhorses, puzzle: s.puzzles, dog: s.dogs },
    costs: hidden ? null : { avgFoodCostPct: Number(s.avgFoodCostPct), avgMargin: Number(s.avgContributionMargin), overallFoodCostPct: Number(s.overallFoodCostPct) },
    highestMargin: hidden ? null : (byMargin[0] ?? null),
    lowestMargin: hidden ? null : (byMargin[byMargin.length - 1] ?? null),
    mostPopular: byMix[0] ?? null,
    leastPopular: byMix[byMix.length - 1] ?? null,
  };
}

export interface MatrixPoint {
  item: MenuItem;
  /** Across, 0 to 100: popularity (menu mix). */
  x: number;
  /** Down, 0 to 100 (0 at the top): margin. */
  y: number;
}

/**
 * The web's engineering matrix (MenuEngineeringMatrix.tsx): the items that sold, placed by menu mix and margin against the shared
 * `matrixAverages`, kept 2% inside the edges; the crosshair at the averages. Null below two sold items, or when a margin is hidden.
 */
export function matrixOf(items: MenuItem[]): { points: MatrixPoint[]; avgX: number; avgY: number } | null {
  if (items.some((i) => i.contributionMargin === undefined)) return null;
  const sold = items.filter((i) => i.unitsSold > 0 && typeof i.contributionMargin === "number");
  if (sold.length < 2) return null;
  const { avgCM, avgMix, maxCM, maxMix } = matrixAverages(sold.map((i) => ({ unitsSold: i.unitsSold, contributionMargin: i.contributionMargin!, menuMixPct: i.menuMixPct })));
  const inside = (n: number) => Math.min(Math.max(n, 2), 98);
  const toX = (mix: number) => inside((mix / maxMix) * 100);
  const toY = (cm: number) => inside(100 - (cm / maxCM) * 100);
  return { points: sold.map((item) => ({ item, x: toX(item.menuMixPct), y: toY(item.contributionMargin!) })), avgX: toX(avgMix), avgY: toY(avgCM) };
}

/** The web's waste column: what the last 30 days of waste of the item's ingredients cost, flagged on a Dog. Null with none. */
export function wasteLabel(item: MenuItem, waste: number | undefined): string | null {
  if (!waste || waste <= 0) return null;
  return item.classification === "dog" ? `Dog + $${waste.toFixed(0)} waste` : `$${waste.toFixed(0)} wasted`;
}

/** One serving's food cost at the location's average cost, set against one serving's share of the price. */
export function plateOf(item: MenuItem, foodCost: number): { price: number; foodCost: number; margin: number; foodCostPct: number | null } {
  const price = item.sellingPrice / Math.max(1, item.servingsPerSale);
  return { price, foodCost, margin: price - foodCost, foodCostPct: price > 0 ? (foodCost / price) * 100 : null };
}

/** What the yield variance route says, in words; `figures` only when the comparison was made and its numbers were sent. */
export function varianceOf(v: YieldVariance): { sentence: string; figures: { theoretical: number; actual: number; variance: number; variancePct: number } | null } {
  const { theoretical, actual, variance, variancePct } = v;
  if (v.status === "ok" && typeof theoretical === "number" && typeof actual === "number" && typeof variance === "number" && typeof variancePct === "number") {
    const way = variance > 0 ? "more" : "less";
    const sentence =
      v.threshold === "good" ? "Within 3% of what the recipe says." : v.threshold === "warning" ? `${pct(Math.abs(variancePct))} ${way} than the recipe says. Worth a look.` : `${pct(Math.abs(variancePct))} ${way} than the recipe says. Check portions and waste.`;
    return { sentence, figures: { theoretical, actual, variance, variancePct } };
  }
  const sentence =
    v.status === "no-period" ? "No sales period is set for this dish yet, so there is nothing to compare."
      : v.status === "no-recipe" ? "This dish has no recipe lines to compare with."
        : v.status === "thin-data" ? "Nothing was logged as used for this dish in its sales period."
          : v.status === "uncosted" ? "What was used has no cost in the catalogue yet."
            : "There is no comparison for this dish yet.";
  return { sentence, figures: null };
}

/** The web's names for the model's actions (MenuItemDetail.tsx); an action this version does not know keeps the server's word. */
const ACTIONS: Record<string, string> = {
  protect: "Protect",
  swap_ingredient: "Swap ingredient",
  adjust_portion: "Adjust portion",
  raise_price: "Raise price",
  lower_price: "Lower price",
  rename: "Rename",
  rewrite_description: "Rewrite description",
  promote: "Promote",
  remove: "Remove",
  generate_replacement: "Replace",
};
export const actionLabel = (type: string) => ACTIONS[type] ?? type.replace(/_/g, " ");
