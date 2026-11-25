import { hasPermission } from "../middleware/auth.js";
import type { TokenPayload } from "../services/authService.js";

/** Fields that give away the book quantity or what stock is worth: a counter without `inventory:cost` counts blind. */
const COST_FIELDS = [
  "expectedQty", "varianceQty", "variancePct", "unitCost",
  "currentQty", "locationUnitCost", "orgUnitCost", "preferredUnitCost", "packCost", "costPerUnit", "actualUnitCost", "totalValue",
  // The menu: item and line costs, margin, the dashboard averages, yield variance and waste (in dollars), and what a sale left on hand.
  "foodCost", "foodCostPct", "contributionMargin", "lineCost", "catalogUnitCost",
  "avgFoodCostPct", "avgContributionMargin", "totalFoodCost", "overallFoodCostPct",
  "theoretical", "actual", "variance", "threshold", "fohOnHand", "wasteEstimate",
] as const;

/** `row` without {@link COST_FIELDS}. */
export function withoutCostFields<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const k of COST_FIELDS) delete copy[k];
  return copy as T;
}

/** `row` as this caller may see it: without {@link COST_FIELDS} unless they hold `inventory:cost`. */
export function forViewer<T extends object>(user: TokenPayload, row: T): T {
  return hasPermission(user, "inventory:cost") ? row : withoutCostFields(row);
}
