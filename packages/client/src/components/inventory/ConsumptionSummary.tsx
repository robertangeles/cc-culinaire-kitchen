/**
 * @module components/inventory/ConsumptionSummary
 *
 * HQ digest view — aggregated consumption data across locations.
 * Date range picker, per-location breakdown, reason bars, top items.
 */

import { useState, useEffect, useMemo } from "react";
import { useConsumptionSummary } from "../../hooks/useInventory.js";
import { BarChart3, MapPin, Loader2, Package } from "lucide-react";

/* ── Date range helpers ─────────────────────────────────────────── */

type RangePreset = "today" | "week" | "custom";

function todayRange(): { start: string; end: string } {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return { start: iso, end: iso };
}

function weekRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const REASON_LABELS: Record<string, string> = {
  kitchen_operations: "Kitchen",
  foh_operations: "FOH",
  staff_consumption: "Staff",
  cleaning: "Cleaning",
  admin: "Admin",
  breakage: "Breakage",
  other: "Other",
};

/* Color palette for reason bars */
const REASON_COLORS: Record<string, string> = {
  kitchen_operations: "#D4A574",
  foh_operations: "#7CB9E8",
  staff_consumption: "#77DD77",
  cleaning: "#B19CD9",
  admin: "#FFB347",
  breakage: "#FF6961",
  other: "#888",
};

/* ── Component ──────────────────────────────────────────────────── */

export default function ConsumptionSummary() {
  const { summary, isLoading, refresh } = useConsumptionSummary();
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  /* Load data on mount and when preset changes */
  useEffect(() => {
    let range: { start: string; end: string };
    if (preset === "today") {
      range = todayRange();
    } else if (preset === "week") {
      range = weekRange();
    } else if (customStart && customEnd) {
      range = { start: customStart, end: customEnd };
    } else {
      return; // custom without dates — wait
    }
    refresh(range.start, range.end);
  }, [preset, customStart, customEnd, refresh]);

  /* Derived data — safe even if summary is null */
  const totalEntries = summary?.totalEntries ?? 0;
  const totalValue = summary?.totalValue ?? 0;
  const byLocation: { locationId: string; locationName: string; entries: number; value: number }[] =
    summary?.byLocation ?? [];
  const byReason: { reason: string; entries: number; percentage: number }[] =
    summary?.byReason ?? [];
  const topItems: {
    ingredientId: string;
    ingredientName: string;
    totalQty: number;
    baseUnit: string;
    totalValue: number;
  }[] = summary?.topItems ?? [];

  /* Max percentage for scaling bars */
  const maxPct = useMemo(
    () => Math.max(...byReason.map((r) => r.percentage), 1),
    [byReason],
  );

  /* ── render ───────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* ── Header + date range ────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D4A574]/20 to-[#D4A574]/5 flex items-center justify-center">
            <BarChart3 size={16} className="text-[#D4A574]" />
          </div>
          <h2 className="text-sm font-semibold tracking-wide text-[#E0E0E0] uppercase">
            Consumption Digest
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {(["today", "week", "custom"] as RangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-full text-xs border transition-all cursor-pointer ${
                preset === p
                  ? "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                  : "bg-[#161616] text-[#888] border-[#2A2A2A] hover:border-[#444] hover:text-[#BBB]"
              }`}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : "Custom"}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {preset === "custom" && (
        <div className="flex gap-3 items-center">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-xs text-[#E0E0E0] focus:outline-none focus:border-[#D4A574]/40 transition-all"
          />
          <span className="text-xs text-[#666]">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-xs text-[#E0E0E0] focus:outline-none focus:border-[#D4A574]/40 transition-all"
          />
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[#666]">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────── */}
      {!isLoading && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 text-center hover:-translate-y-0.5 transition-transform">
              <p className="text-xs text-[#888] font-medium mb-1">Total Entries</p>
              <p className="text-2xl font-bold text-white">{totalEntries}</p>
            </div>
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 text-center hover:-translate-y-0.5 transition-transform">
              <p className="text-xs text-[#888] font-medium mb-1">Total Value</p>
              <p className="text-2xl font-bold text-white">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>

          {/* By location */}
          {byLocation.length > 0 && (
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[#D4A574]" />
                <h3 className="text-xs font-semibold tracking-wide text-[#888] uppercase">
                  By Location
                </h3>
              </div>
              <div className="space-y-2">
                {byLocation.map((loc) => (
                  <div
                    key={loc.locationId}
                    className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
                  >
                    <span className="text-sm text-[#E0E0E0]">{loc.locationName}</span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-[#888]">
                        {loc.entries} {loc.entries === 1 ? "entry" : "entries"}
                      </span>
                      <span className="text-[#D4A574] font-medium min-w-[3.5rem] text-right">
                        ${loc.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By reason — horizontal bars */}
          {byReason.length > 0 && (
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-[#D4A574]" />
                <h3 className="text-xs font-semibold tracking-wide text-[#888] uppercase">
                  By Reason
                </h3>
              </div>
              <div className="space-y-2.5">
                {byReason.map((r) => {
                  const color = REASON_COLORS[r.reason] ?? "#888";
                  const widthPct = (r.percentage / maxPct) * 100;
                  return (
                    <div key={r.reason} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#CCC]">
                          {REASON_LABELS[r.reason] ?? r.reason}
                        </span>
                        <span className="text-[#888]">{r.percentage}%</span>
                      </div>
                      <div className="h-2 bg-[#1A1A1A] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: color,
                            boxShadow: `0 0 8px ${color}40`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top items */}
          {topItems.length > 0 && (
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-[#D4A574]" />
                <h3 className="text-xs font-semibold tracking-wide text-[#888] uppercase">
                  Top Items
                </h3>
              </div>
              <div className="space-y-1.5">
                {topItems.slice(0, 10).map((item, i) => (
                  <div
                    key={item.ingredientId}
                    className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0"
                  >
                    <span className="w-5 text-right text-xs text-[#555] font-mono">
                      {i + 1}.
                    </span>
                    <span className="text-sm text-[#E0E0E0] flex-1 truncate">
                      {item.ingredientName}
                    </span>
                    <span className="text-xs text-[#888] min-w-[4rem] text-right">
                      {Number(item.totalQty).toFixed(1)} {item.baseUnit}
                    </span>
                    <span className="text-xs text-[#D4A574] font-medium min-w-[3rem] text-right">
                      ${Number(item.totalValue).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {totalEntries === 0 && (
            <div className="bg-[#111]/60 border border-white/5 rounded-xl px-6 py-10 text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4A574]/15 to-[#D4A574]/5 flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(212,165,116,0.08)]">
                <BarChart3 size={22} className="text-[#D4A574]/60" />
              </div>
              <p className="text-sm text-[#888] mb-1">No consumption data</p>
              <p className="text-xs text-[#555]">
                Entries logged during this period will appear here
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
