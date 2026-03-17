/**
 * Summary stat cards for the Menu Intelligence dashboard.
 */

import { Star, TrendingDown, HelpCircle, XCircle, DollarSign, BarChart3 } from "lucide-react";
import type { MenuAnalysis } from "../../hooks/useMenuAnalysis.js";

const QUAD_CONFIG = [
  { key: "stars", label: "Stars", icon: Star, color: "text-amber-600 bg-amber-50", desc: "High profit, high popularity" },
  { key: "plowhorses", label: "Plowhorses", icon: TrendingDown, color: "text-blue-600 bg-blue-50", desc: "Low profit, high popularity" },
  { key: "puzzles", label: "Puzzles", icon: HelpCircle, color: "text-purple-600 bg-purple-50", desc: "High profit, low popularity" },
  { key: "dogs", label: "Dogs", icon: XCircle, color: "text-red-600 bg-red-50", desc: "Low profit, low popularity" },
] as const;

export function MenuSummaryCards({ analysis }: { analysis: MenuAnalysis }) {
  return (
    <div className="space-y-4">
      {/* Quadrant counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {QUAD_CONFIG.map(({ key, label, icon: Icon, color, desc }) => (
          <div key={key} className={`rounded-xl border border-stone-200 p-4 ${color}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="size-4" />
              <span className="text-sm font-semibold">{label}</span>
            </div>
            <p className="text-2xl font-bold">{analysis[key]}</p>
            <p className="text-xs opacity-70">{desc}</p>
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500 mb-1">Total Items</p>
          <p className="text-xl font-bold text-stone-800">{analysis.totalItems}</p>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500 mb-1">Avg Food Cost</p>
          <p className="text-xl font-bold text-stone-800">{analysis.avgFoodCostPct}%</p>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500 mb-1">Avg Contribution Margin</p>
          <p className="text-xl font-bold text-stone-800">${analysis.avgContributionMargin}</p>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <p className="text-xs text-stone-500 mb-1">Overall Food Cost</p>
          <p className="text-xl font-bold text-stone-800">{analysis.overallFoodCostPct}%</p>
        </div>
      </div>
    </div>
  );
}
