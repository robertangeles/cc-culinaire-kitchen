/**
 * @module components/inventory/ForecastCard
 *
 * Dashboard card showing top AI-powered reorder recommendations
 * sorted by urgency. Displays days remaining with color coding,
 * suggested order quantities, and action buttons.
 */

import { useState } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useForecasts, type ForecastRecommendation } from "../../hooks/useInventory.js";
import {
  BrainCircuit,
  Loader2,
  RefreshCw,
  ShoppingCart,
  X,
  AlertTriangle,
  TrendingDown,
  Sparkles,
  PackageSearch,
} from "lucide-react";

/* ── Helpers ──────────────────────────────────────────────────── */

function daysColor(days: number | null): string {
  if (days === null) return "text-zinc-400";
  if (days < 3) return "text-red-400";
  if (days < 7) return "text-amber-400";
  return "text-emerald-400";
}

function daysBg(days: number | null): string {
  if (days === null) return "bg-zinc-800/50";
  if (days < 3) return "bg-red-900/30 border-red-600/20";
  if (days < 7) return "bg-amber-900/30 border-amber-600/20";
  return "bg-emerald-900/30 border-emerald-600/20";
}

function confidencePct(confidence: string | null): string {
  if (!confidence) return "0%";
  return `${Math.round(Number(confidence) * 100)}%`;
}

/* ── Recommendation row ───────────────────────────────────────── */

function RecommendationRow({
  rec,
  onDismiss,
  onOrder,
  busy,
}: {
  rec: ForecastRecommendation;
  onDismiss: (id: string) => void;
  onOrder: (id: string) => void;
  busy: string | null;
}) {
  const isBusy = busy === rec.recommendationId;
  const days = rec.daysRemaining;

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-1/50 border border-white/5 hover:border-amber-500/15 hover:bg-surface-1/70 transition-all duration-200">
      {/* Days remaining badge */}
      <div
        className={`flex-shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center border ${daysBg(days)}`}
      >
        <span className={`text-lg font-bold leading-none ${daysColor(days)}`}>
          {days ?? "--"}
        </span>
        <span className="text-[10px] text-zinc-500 leading-none mt-0.5">days</span>
      </div>

      {/* Item info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">
          {rec.ingredientName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-zinc-500">
            Stock: {rec.currentQty ? Number(rec.currentQty).toFixed(1) : "0"} {rec.baseUnit}
          </span>
          <span className="text-xs text-zinc-600">|</span>
          <span className="text-xs text-zinc-500">
            Order: {rec.suggestedOrderQty ? Number(rec.suggestedOrderQty).toFixed(0) : "--"} {rec.baseUnit}
          </span>
        </div>
      </div>

      {/* Confidence */}
      <div className="flex-shrink-0 hidden sm:flex flex-col items-center">
        <div className="w-8 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
            style={{ width: confidencePct(rec.confidence) }}
          />
        </div>
        <span className="text-[10px] text-zinc-500 mt-0.5">
          {confidencePct(rec.confidence)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onOrder(rec.recommendationId)}
          disabled={isBusy}
          className="p-1.5 rounded-lg bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 transition-colors disabled:opacity-50"
          title="Create PO"
        >
          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
        </button>
        <button
          onClick={() => onDismiss(rec.recommendationId)}
          disabled={isBusy}
          className="p-1.5 rounded-lg bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export default function ForecastCard() {
  const { selectedLocationId } = useLocation();
  const {
    recommendations,
    isLoading,
    generate,
    dismiss,
    markOrdered,
    refresh,
  } = useForecasts(selectedLocationId);

  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const top5 = recommendations.slice(0, 5);
  const hasData = recommendations.length > 0;

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generate();
    } catch {
      /* handled by hook */
    } finally {
      setGenerating(false);
    }
  }

  async function handleDismiss(id: string) {
    setBusy(id);
    try {
      await dismiss(id);
    } catch {
      /* handled by hook */
    } finally {
      setBusy(null);
    }
  }

  async function handleOrder(id: string) {
    setBusy(id);
    try {
      await markOrdered(id);
    } catch {
      /* handled by hook */
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl bg-surface-2/50 border border-white/5 backdrop-blur-sm shadow-[0_0_24px_rgba(0,0,0,0.3)] overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 shadow-[0_0_12px_rgba(255,214,10,0.1)]">
            <BrainCircuit size={20} className="text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">Reorder Forecasts</h3>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <Sparkles size={10} />
                AI-powered
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              {hasData
                ? `${recommendations.length} recommendation${recommendations.length !== 1 ? "s" : ""}`
                : "Based on 30-day consumption"}
            </p>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="p-2 rounded-lg bg-surface-1/60 border border-white/5 text-zinc-400 hover:text-amber-400 hover:border-amber-500/20 transition-all disabled:opacity-50"
          title="Regenerate forecasts"
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>
      </div>

      {/* Card body */}
      <div className="px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-amber-400" />
          </div>
        ) : !hasData ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-2xl bg-zinc-800/50 border border-white/5 mb-3 shadow-[0_0_16px_rgba(255,214,10,0.05)]">
              <PackageSearch size={28} className="text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-400 font-medium">
              Insufficient usage history
            </p>
            <p className="text-xs text-zinc-500 mt-1 max-w-[240px]">
              Forecasts activate after 2 stock take cycles with consumption data recorded.
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/15 text-amber-400 text-xs font-medium hover:bg-amber-600/25 transition-colors border border-amber-500/20 disabled:opacity-50"
            >
              {generating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Run Forecast Now
            </button>
          </div>
        ) : (
          /* Recommendations list */
          <div className="space-y-2">
            {top5.map((rec) => (
              <RecommendationRow
                key={rec.recommendationId}
                rec={rec}
                onDismiss={handleDismiss}
                onOrder={handleOrder}
                busy={busy}
              />
            ))}

            {recommendations.length > 5 && (
              <p className="text-xs text-zinc-500 text-center pt-2">
                +{recommendations.length - 5} more recommendation{recommendations.length - 5 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {/* Urgency summary bar */}
        {hasData && (
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/5">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-red-400" />
              <span className="text-xs text-zinc-400">
                {recommendations.filter((r) => (r.daysRemaining ?? 99) < 3).length} critical
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingDown size={12} className="text-amber-400" />
              <span className="text-xs text-zinc-400">
                {recommendations.filter((r) => {
                  const d = r.daysRemaining ?? 99;
                  return d >= 3 && d < 7;
                }).length} low
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
