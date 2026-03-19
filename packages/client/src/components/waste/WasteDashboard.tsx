/**
 * @module components/waste/WasteDashboard
 *
 * Summary dashboard for waste analytics. Shows KPI cards (with trend),
 * monthly extrapolation, top ingredients by cost/weight, waste by reason
 * breakdown with distinct colors and percentage labels, daily trend chart
 * (horizontally scrollable on mobile), and an industry benchmark callout.
 * Friendly empty state directs users to the Log Waste tab.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, TrendingUp, TrendingDown, Minus,
  Scale, DollarSign, ClipboardList, BarChart3, Leaf,
} from "lucide-react";
import type { WasteTab } from "../../pages/WasteIntelligencePage.js";

type Period = "7" | "30" | "90" | "custom";

interface SummaryData {
  totalWeight: number;
  totalCost: number;
  totalEntries: number;
  topByCost?: { name: string; cost: number }[];
  topByWeight?: { name: string; weight: number; unit: string }[];
  byReason?: { reason: string; count: number; cost: number }[];
  dailyTotals?: { date: string; weight: number; cost: number }[];
}

interface Props {
  onSwitchTab: (tab: WasteTab) => void;
  teamView?: boolean;
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

export function WasteDashboard({ onSwitchTab, teamView = false }: Props) {
  const [period, setPeriod] = useState<Period>("30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryData | null>(null);
  const [prevData, setPrevData] = useState<SummaryData | null>(null);

  const getDaysCount = useCallback(() => {
    if (period === "custom" && customStart && customEnd) {
      const ms = new Date(customEnd).getTime() - new Date(customStart).getTime();
      return Math.max(Math.ceil(ms / 86400000), 1);
    }
    return Number(period) || 30;
  }, [period, customStart, customEnd]);

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

      // Fetch current period
      const teamParam = teamView ? "&teamView=true" : "";
      const res = await fetch(
        `/api/waste/summary?startDate=${startDate}&endDate=${endDate}${teamParam}`,
        { credentials: "include" },
      );

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }

      const json = await res.json();
      setData(json);

      // Fetch previous period for trend comparison
      const days = getDaysCount();
      const prevEnd = new Date(startDate);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - days);

      try {
        const prevRes = await fetch(
          `/api/waste/summary?startDate=${prevStart.toISOString().split("T")[0]}&endDate=${prevEnd.toISOString().split("T")[0]}${teamParam}`,
          { credentials: "include" },
        );
        if (prevRes.ok) {
          const prevJson = await prevRes.json();
          setPrevData(prevJson);
        } else {
          setPrevData(null);
        }
      } catch {
        setPrevData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd, getDaysCount, teamView]);

  useEffect(() => {
    if (period === "custom" && (!customStart || !customEnd)) return;
    fetchSummary();
  }, [fetchSummary, period, customStart, customEnd]);

  // Trend calculation
  const currentCost = Number(data?.totalCost ?? 0);
  const prevCost = Number(prevData?.totalCost ?? 0);
  let trendDirection: "up" | "down" | "flat" = "flat";
  let trendPercent = 0;
  if (prevCost > 0 && currentCost > 0) {
    trendPercent = Math.round(((currentCost - prevCost) / prevCost) * 100);
    if (trendPercent > 0) trendDirection = "up";
    else if (trendPercent < 0) trendDirection = "down";
    trendPercent = Math.abs(trendPercent);
  }

  const TrendIcon = trendDirection === "up" ? TrendingUp : trendDirection === "down" ? TrendingDown : Minus;
  const trendColor = trendDirection === "up" ? "text-red-400" : trendDirection === "down" ? "text-emerald-400" : "text-gray-400";

  // Monthly extrapolation
  const days = getDaysCount();
  const dailyAvgCost = days > 0 ? currentCost / days : 0;
  const monthlyEstimate = dailyAvgCost * 30;

  // Reason totals for percentage calculation
  const reasonTotalCost = (data?.byReason ?? []).reduce((sum, r) => sum + Number(r?.cost ?? 0), 0);

  return (
    <div>
      {/* Dashboard title */}
      <h2 className="text-lg font-semibold text-white mb-4">
        {teamView ? "Team Dashboard" : "My Dashboard"}
      </h2>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPeriod(opt.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
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
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500 min-h-[44px]"
          />
          <span className="text-gray-500 self-center">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500 min-h-[44px]"
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

      {/* Empty state */}
      {!loading && !error && (!data || (Number(data?.totalEntries ?? 0) === 0)) && (
        <div className="text-center py-16">
          <Leaf className="size-16 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-300 mb-2">Start logging waste to see your kitchen&apos;s impact</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Once you start tracking, you&apos;ll see exactly where your money goes and how to save it.
          </p>
          <button
            onClick={() => onSwitchTab("log")}
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors min-h-[44px]"
          >
            Go to Log Waste
          </button>
        </div>
      )}

      {/* Dashboard content */}
      {!loading && !error && data && Number(data?.totalEntries ?? 0) > 0 && (
        <>
          {/* Summary cards — 2x2 on mobile, 4 in a row on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <SummaryCard
              icon={<Scale className="size-5 text-amber-500" />}
              label="Total Waste"
              value={`${Number(data?.totalWeight ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`}
            />
            <SummaryCard
              icon={<DollarSign className="size-5 text-amber-500" />}
              label="Total Cost"
              value={`$${Number(data?.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            />
            <SummaryCard
              icon={<ClipboardList className="size-5 text-amber-500" />}
              label="Entries"
              value={String(data?.totalEntries ?? 0)}
            />
            <SummaryCard
              icon={<TrendIcon className={`size-5 ${trendColor}`} />}
              label="Trend"
              value={trendDirection === "flat" ? "--" : `${trendDirection === "down" ? "\u2193" : "\u2191"}${trendPercent}%`}
              valueClass={trendColor}
              sublabel={trendDirection === "flat" ? "Not enough data yet" : "vs previous period"}
            />
          </div>

          {/* Monthly extrapolation */}
          {monthlyEstimate > 0 && (
            <div className="mb-8 bg-amber-900/20 border border-amber-700/30 rounded-xl p-4 text-center">
              <p className="text-sm text-amber-300">
                At this rate, your kitchen wastes approximately{" "}
                <span className="font-bold text-amber-400">
                  ${monthlyEstimate.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>{" "}
                per month
              </p>
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Top 5 by cost */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Top Ingredients by Cost</h3>
              {!data?.topByCost?.length ? (
                <p className="text-gray-500 text-sm">No data yet</p>
              ) : (
                <BarList
                  items={data.topByCost.map((i) => ({
                    label: i?.name ?? "Unknown",
                    value: Number(i?.cost ?? 0),
                    display: `$${Number(i?.cost ?? 0).toFixed(2)}`,
                  }))}
                  color="bg-amber-500"
                />
              )}
            </div>

            {/* Top 5 by weight */}
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Top Ingredients by Weight</h3>
              {!data?.topByWeight?.length ? (
                <p className="text-gray-500 text-sm">No data yet</p>
              ) : (
                <BarList
                  items={data.topByWeight.map((i) => ({
                    label: i?.name ?? "Unknown",
                    value: Number(i?.weight ?? 0),
                    display: `${Number(i?.weight ?? 0).toLocaleString()} ${i?.unit ?? "kg"}`,
                  }))}
                  color="bg-amber-500"
                />
              )}
            </div>
          </div>

          {/* Waste by reason */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-8">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Waste by Reason</h3>
            {!data?.byReason?.length ? (
              <p className="text-gray-500 text-sm">No data yet</p>
            ) : (
              <div className="space-y-3">
                {data.byReason.map((r) => {
                  const cost = Number(r?.cost ?? 0);
                  const count = Number(r?.count ?? 0);
                  const pct = reasonTotalCost > 0 ? Math.round((cost / reasonTotalCost) * 100) : 0;
                  const maxCost = Math.max(...(data?.byReason ?? []).map((x) => Number(x?.cost ?? 0)), 1);
                  const barWidth = Math.max((cost / maxCost) * 100, 2);
                  const barColor = REASON_COLORS[r?.reason ?? ""] ?? "bg-gray-500";

                  return (
                    <div key={r?.reason ?? "unknown"}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-300 truncate mr-2">{r?.reason || "Unspecified"}</span>
                        <span className="text-gray-400 shrink-0">
                          {count} entries — ${cost.toFixed(2)}{" "}
                          <span className="text-gray-500">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Daily trend — horizontally scrollable on mobile */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-8">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Daily Waste Trend</h3>
            {!data?.dailyTotals?.length ? (
              <p className="text-gray-500 text-sm">No data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ minWidth: `${Math.max((data?.dailyTotals?.length ?? 0) * 28, 300)}px` }}>
                  <DailyBarChart data={data.dailyTotals} />
                </div>
              </div>
            )}
          </div>

          {/* Industry benchmark */}
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 flex items-start gap-3">
            <BarChart3 className="size-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-300 font-medium">Industry Benchmark</p>
              <p className="text-xs text-gray-500 mt-1">
                Industry average waste: 4-10% of food purchases. Track your purchases to see where you stand.
              </p>
            </div>
          </div>
        </>
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
  const max = Math.max(...items.map((i) => i?.value ?? 0), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item?.label ?? "unknown"}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-300 truncate mr-2">{item?.label}</span>
            <span className="text-gray-400 shrink-0">{item?.display}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${item?.color || color || "bg-amber-500"}`}
              style={{ width: `${Math.max(((item?.value ?? 0) / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyBarChart({ data }: { data: { date: string; weight: number; cost: number }[] }) {
  const maxWeight = Math.max(...data.map((d) => Number(d?.weight ?? 0)), 1);

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const weight = Number(d?.weight ?? 0);
        const cost = Number(d?.cost ?? 0);
        const heightPct = Math.max((weight / maxWeight) * 100, 3);
        const dateLabel = new Date(d?.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <div key={d?.date} className="flex flex-col items-center flex-1 min-w-[24px] group relative">
            {/* Tooltip */}
            <div className="hidden group-hover:block absolute bottom-full mb-1 bg-gray-700 text-xs text-white px-2 py-1 rounded shadow-lg whitespace-nowrap z-10">
              {dateLabel}: {weight} kg — ${cost.toFixed(2)}
            </div>
            <div
              className="w-full bg-amber-500 rounded-t transition-all duration-300 hover:bg-amber-400"
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-[9px] text-gray-500 mt-1 truncate w-full text-center">
              {new Date(d?.date).getDate()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
