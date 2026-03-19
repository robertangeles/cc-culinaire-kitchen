/**
 * @module components/menu/MenuDashboard
 *
 * Summary cards for Menu Intelligence dashboard.
 * Shows quadrant counts, key metrics, and top/bottom performers.
 */

import {
  Star,
  TrendingDown,
  HelpCircle,
  XCircle,
  DollarSign,
  BarChart3,
  TrendingUp,
  Award,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type { MenuAnalysis } from "../../hooks/useMenuAnalysis.js";
import type { MenuItem } from "../../hooks/useMenuItems.js";

const QUAD_CONFIG = [
  {
    key: "stars" as const,
    label: "Stars",
    icon: Star,
    bg: "bg-[#D4A574]/15",
    text: "text-[#D4A574]",
    border: "border-[#D4A574]/20",
    desc: "High profit, high popularity",
  },
  {
    key: "plowhorses" as const,
    label: "Plowhorses",
    icon: TrendingDown,
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/20",
    desc: "Low profit, high popularity",
  },
  {
    key: "puzzles" as const,
    label: "Puzzles",
    icon: HelpCircle,
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    border: "border-purple-500/20",
    desc: "High profit, low popularity",
  },
  {
    key: "dogs" as const,
    label: "Dogs",
    icon: XCircle,
    bg: "bg-[#2A2A2A]",
    text: "text-[#666666]",
    border: "border-[#333333]",
    desc: "Low profit, low popularity",
  },
] as const;

interface MenuDashboardProps {
  analysis: MenuAnalysis | null;
  loading: boolean;
  onFilterDogs?: () => void;
}

export function MenuDashboard({ analysis, loading, onFilterDogs }: MenuDashboardProps) {
  if (loading && !analysis) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (!analysis || analysis.totalItems === 0) {
    return (
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-12 text-center">
        <BarChart3 className="size-12 mx-auto mb-4 text-[#333333]" />
        <h3 className="text-lg font-semibold text-[#FAFAFA] mb-2">
          No menu data yet
        </h3>
        <p className="text-sm text-[#666666] max-w-md mx-auto">
          Add your first menu item to see engineering insights. Switch to the
          Menu Items tab to get started.
        </p>
      </div>
    );
  }

  const items = analysis.items ?? [];

  // Find top/bottom performers
  const sortedByMargin = [...items].sort(
    (a, b) => b.contributionMargin - a.contributionMargin
  );
  const highestMargin = sortedByMargin[0] ?? null;
  const lowestMargin = sortedByMargin[sortedByMargin.length - 1] ?? null;

  const sortedByPopularity = [...items].sort(
    (a, b) => b.menuMixPct - a.menuMixPct
  );
  const mostPopular = sortedByPopularity[0] ?? null;
  const leastPopular =
    sortedByPopularity[sortedByPopularity.length - 1] ?? null;

  return (
    <div className="space-y-6">
      {/* Quadrant count cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {QUAD_CONFIG.map(({ key, label, icon: Icon, bg, text, border, desc }) => (
          <div
            key={key}
            className={`${bg} rounded-2xl border ${border} p-4 min-h-[100px]`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`size-4 ${text}`} />
              <span className={`text-sm font-semibold ${text}`}>{label}</span>
            </div>
            <p className={`text-3xl font-bold ${text}`}>{analysis[key]}</p>
            <p className="text-xs text-[#666666] mt-1">{desc}</p>
            {key === "dogs" && analysis.dogs > 0 && onFilterDogs && (
              <button
                onClick={onFilterDogs}
                className="text-xs text-[#D4A574] hover:text-[#C4956A] mt-2 transition-colors"
              >
                Generate replacements &rarr;
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={BarChart3}
          label="Total Items Analyzed"
          value={String(analysis.totalItems)}
        />
        <MetricCard
          icon={DollarSign}
          label="Avg Food Cost"
          value={`${Number(analysis.avgFoodCostPct).toFixed(1)}%`}
          alert={Number(analysis.avgFoodCostPct) > 35}
        />
        <MetricCard
          icon={TrendingUp}
          label="Avg Contribution Margin"
          value={`$${Number(analysis.avgContributionMargin).toFixed(2)}`}
        />
        <MetricCard
          icon={DollarSign}
          label="Overall Food Cost"
          value={`${Number(analysis.overallFoodCostPct).toFixed(1)}%`}
          alert={Number(analysis.overallFoodCostPct) > 35}
        />
      </div>

      {/* Top/bottom performers */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PerformerCard
            icon={Award}
            label="Highest Margin"
            item={highestMargin}
            metric={
              highestMargin
                ? `$${highestMargin.contributionMargin.toFixed(2)} CM`
                : ""
            }
            color="text-green-400"
          />
          <PerformerCard
            icon={AlertTriangle}
            label="Lowest Margin"
            item={lowestMargin}
            metric={
              lowestMargin
                ? `$${lowestMargin.contributionMargin.toFixed(2)} CM`
                : ""
            }
            color="text-red-400"
          />
          <PerformerCard
            icon={TrendingUp}
            label="Most Popular"
            item={mostPopular}
            metric={
              mostPopular
                ? `${mostPopular.menuMixPct.toFixed(1)}% mix`
                : ""
            }
            color="text-blue-400"
          />
          <PerformerCard
            icon={TrendingDown}
            label="Least Popular"
            item={leastPopular}
            metric={
              leastPopular
                ? `${leastPopular.menuMixPct.toFixed(1)}% mix`
                : ""
            }
            color="text-[#666666]"
          />
        </div>
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function MetricCard({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="size-4 text-[#666666]" />
        <p className="text-xs text-[#666666]">{label}</p>
      </div>
      <p
        className={`text-xl font-bold ${
          alert ? "text-red-400" : "text-[#FAFAFA]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PerformerCard({
  icon: Icon,
  label,
  item,
  metric,
  color,
}: {
  icon: typeof Award;
  label: string;
  item: MenuItem | null;
  metric: string;
  color: string;
}) {
  if (!item) return null;
  return (
    <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-4 flex items-center gap-3">
      <div
        className={`flex-shrink-0 size-10 rounded-xl bg-[#0A0A0A] flex items-center justify-center`}
      >
        <Icon className={`size-5 ${color}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[#666666]">{label}</p>
        <p className="text-sm font-semibold text-[#FAFAFA] truncate">
          {item.name}
        </p>
        <p className={`text-xs font-medium ${color}`}>{metric}</p>
      </div>
    </div>
  );
}
