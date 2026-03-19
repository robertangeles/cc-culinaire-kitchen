/**
 * @module components/waste/WasteDashboard
 *
 * Summary dashboard for waste analytics. Shows KPI cards, top ingredients
 * by cost/weight, waste by reason breakdown, daily trend, and an
 * industry benchmark callout. All charts are pure CSS (no chart library).
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, Scale, DollarSign, Hash, BarChart3 } from "lucide-react";

type Period = "7" | "30" | "90" | "custom";

interface SummaryData {
  totalWeight: number;
  totalWeightUnit: string;
  totalCost: number;
  totalEntries: number;
  trendDirection: "up" | "down" | "flat";
  trendPercent: number;
  topByCost: { name: string; cost: number }[];
  topByWeight: { name: string; weight: number; unit: string }[];
  byReason: { reason: string; count: number; cost: number }[];
  dailyTotals: { date: string; weight: number; cost: number }[];
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7", label: "Last 7 Days" },
  { value: "30", label: "Last 30 Days" },
  { value: "90", label: "Last 90 Days" },
  { value: "custom", label: "Custom" },
];

const REASON_COLORS: Record<string, string> = {
  Overproduction: "bg-amber-500",
  Spoilage: "bg-red-500",
  "Trim/Peel": "bg-green-500",
  "Plate Waste": "bg-blue-500",
  Contamination: "bg-purple-500",
  Expired: "bg-orange-500",
  Other: "bg-gray-500",
};

export function WasteDashboard() {
  const [period, setPeriod] = useState<Period>("30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryData | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let startDate: string;
      let endDate: string;

      if (period === "custom" && customStart && customEnd) {
        startDate = customStart;
        endDate = customEnd;
      } else {
        const days = Number(period) || 30;
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);
        startDate = start.toISOString().split("T")[0];
        endDate = end.toISOString().split("T")[0];
      }

      const res = await fetch(
        `/api/waste/summary?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" },
      );

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }

      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => {
    if (period === "custom" && (!customStart || !customEnd)) return;
    fetchSummary();
  }, [fetchSummary, period, customStart, customEnd]);

  const TrendIcon = data?.trendDirection === "up" ? TrendingUp : data?.trendDirection === "down" ? TrendingDown : Minus;
  const trendColor = data?.trendDirection === "up" ? "text-red-400" : data?.trendDirection === "down" ? "text-green-400" : "text-gray-400";

  return (
    <div>
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPeriod(opt.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === opt.value
                ? "bg-amber-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {period === "custom" && (
        <div className="flex flex-wrap gap-3 mb-6">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500"
          />
          <span className="text-gray-500 self-center">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500"
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-amber-500" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Dashboard content */}
      {!loading && !error && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              icon={<Scale className="size-5 text-amber-500" />}
              label="Total Waste"
              value={`${data.totalWeight.toLocaleString()} ${data.totalWeightUnit}`}
            />
            <SummaryCard
              icon={<DollarSign className="size-5 text-amber-500" />}
              label="Total Cost"
              value={`$${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            />
            <SummaryCard
              icon={<Hash className="size-5 text-amber-500" />}
              label="Total Entries"
              value={data.totalEntries.toLocaleString()}
            />
            <SummaryCard
              icon={<TrendIcon className={`size-5 ${trendColor}`} />}
              label="Waste Trend"
              value={`${data.trendDirection === "flat" ? "--" : `${data.trendPercent}%`}`}
              valueClass={trendColor}
              sublabel={data.trendDirection === "up" ? "vs previous period" : data.trendDirection === "down" ? "vs previous period" : "no change"}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Top 5 by cost */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Top 5 Ingredients by Cost</h3>
              {!data?.topByCost || data.topByCost.length === 0 ? (
                <p className="text-gray-500 text-sm">No data yet</p>
              ) : (
                <BarList
                  items={data.topByCost.map((i) => ({
                    label: i.name,
                    value: i.cost,
                    display: `$${i.cost.toFixed(2)}`,
                  }))}
                  color="bg-amber-500"
                />
              )}
            </div>

            {/* Top 5 by weight */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Top 5 Ingredients by Weight</h3>
              {!data?.topByWeight || data.topByWeight.length === 0 ? (
                <p className="text-gray-500 text-sm">No data yet</p>
              ) : (
                <BarList
                  items={data.topByWeight.map((i) => ({
                    label: i.name,
                    value: i.weight,
                    display: `${i.weight.toLocaleString()} ${i.unit}`,
                  }))}
                  color="bg-amber-500"
                />
              )}
            </div>
          </div>

          {/* Waste by reason */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-8">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Waste by Reason</h3>
            {!data?.byReason || data.byReason.length === 0 ? (
              <p className="text-gray-500 text-sm">No data yet</p>
            ) : (
              <BarList
                items={data.byReason.map((r) => ({
                  label: r.reason || "Unspecified",
                  value: r.cost,
                  display: `${r.count} entries — $${r.cost.toFixed(2)}`,
                  color: REASON_COLORS[r.reason] || "bg-gray-500",
                }))}
              />
            )}
          </div>

          {/* Daily trend */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-8">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Daily Waste Trend</h3>
            {!data?.dailyTotals || data.dailyTotals.length === 0 ? (
              <p className="text-gray-500 text-sm">No data yet</p>
            ) : (
              <DailyBarChart data={data.dailyTotals} />
            )}
          </div>

          {/* Benchmark */}
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 flex items-start gap-3">
            <BarChart3 className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-300 font-medium">Industry Benchmark</p>
              <p className="text-xs text-gray-500 mt-1">
                Industry average food waste is 4-10% of food purchases. Track your waste consistently to see how you compare.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && !data && (
        <div className="text-center py-16">
          <BarChart3 className="size-10 mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No waste data for this period.</p>
          <p className="text-sm text-gray-500 mt-1">Start logging waste to see your dashboard.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon,
  label,
  value,
  valueClass = "text-white",
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
    </div>
  );
}

function BarList({
  items,
  color,
}: {
  items: { label: string; value: number; display: string; color?: string }[];
  color?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-300 truncate mr-2">{item.label}</span>
            <span className="text-gray-400 shrink-0">{item.display}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${item.color || color || "bg-amber-500"}`}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyBarChart({ data }: { data: { date: string; weight: number; cost: number }[] }) {
  const maxWeight = Math.max(...data.map((d) => d.weight), 1);

  return (
    <div className="flex items-end gap-1 h-32 overflow-x-auto">
      {data.map((d) => {
        const heightPct = Math.max((d.weight / maxWeight) * 100, 3);
        const dateLabel = new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <div key={d.date} className="flex flex-col items-center flex-1 min-w-[24px] group relative">
            {/* Tooltip */}
            <div className="hidden group-hover:block absolute bottom-full mb-1 bg-gray-700 text-xs text-white px-2 py-1 rounded shadow-lg whitespace-nowrap z-10">
              {dateLabel}: {d.weight}g — ${d.cost.toFixed(2)}
            </div>
            <div
              className="w-full bg-amber-500 rounded-t transition-all duration-300 hover:bg-amber-400"
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-[9px] text-gray-500 mt-1 truncate w-full text-center">
              {new Date(d.date).getDate()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
