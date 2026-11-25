/**
 * What the menu screens show, as pure functions. The cost rule lives here: a food cost, percentage or margin is what the server stored
 * (with the shared costing) and is shown only when the server sent it to someone who may see costs; nothing is worked out from what is left.
 */

import { DEFAULT_CATEGORY_TARGET_PCT, categoryActualFoodCostPct } from "@culinaire/shared";
import type { MenuItem, MenuLine } from "@culinaire/shared/schemas/menu";

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
