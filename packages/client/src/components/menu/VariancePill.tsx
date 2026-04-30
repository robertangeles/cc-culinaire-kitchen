/**
 * @module components/menu/VariancePill
 *
 * Phase 4a: yield variance pill for the Menu Intelligence list view.
 *
 * Color matches the design spec:
 *   - good     (|variance| ≤ 3%)   green
 *   - warning  (3% < |v| ≤ 8%)     amber
 *   - alert    (|v| > 8%)          red
 *
 * Sign matters: positive = overuse (actual > theoretical) = bad direction.
 * Negative (underuse) is fine — same color tier, but rendered with a "−"
 * sign so the chef can tell at a glance.
 *
 * Status surfaces ("no-period", "thin-data", "no-recipe") render as a
 * neutral em-dash with a tooltip explaining why.
 */

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { YieldVariance } from "../../hooks/useYieldVariance.js";

interface Props {
  variance: YieldVariance | undefined;
}

const STATUS_TOOLTIP: Record<string, string> = {
  "no-period": "No sales period uploaded yet — import sales to compute variance",
  "thin-data": "Not enough kitchen-operations consumption logs in this period",
  "no-recipe": "Add ingredients to this dish before computing variance",
};

const THRESHOLD_CLASSES: Record<string, string> = {
  good:    "bg-emerald-50 text-emerald-700 border border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border border-amber-200",
  alert:   "bg-red-50 text-red-700 border border-red-200",
};

export function VariancePill({ variance }: Props) {
  if (!variance) {
    return <span className="text-stone-400 text-xs">—</span>;
  }

  if (variance.status !== "ok") {
    return (
      <span
        title={STATUS_TOOLTIP[variance.status] ?? "Variance unavailable"}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-stone-100 text-stone-500 border border-stone-200"
      >
        <Minus className="size-3" /> —
      </span>
    );
  }

  const cls = THRESHOLD_CLASSES[variance.threshold ?? "good"];
  const Icon = variance.variancePct > 0 ? TrendingUp : variance.variancePct < 0 ? TrendingDown : Minus;
  const sign = variance.variancePct > 0 ? "+" : "";
  const tooltip = `Theoretical $${variance.theoretical.toFixed(2)} · Actual $${variance.actual.toFixed(2)} · ${variance.consumptionLogCount} log${variance.consumptionLogCount === 1 ? "" : "s"}`;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      <Icon className="size-3" />
      {sign}{variance.variancePct.toFixed(1)}%
    </span>
  );
}
