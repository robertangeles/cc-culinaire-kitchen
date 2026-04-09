/**
 * @module components/inventory/OpeningInventory
 *
 * Dedicated opening inventory flow -- visually distinct from regular stock takes.
 * Guides users through their first full count to activate a location's inventory.
 * Uses CategoryCounter for the actual counting interface.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { CategoryCounter } from "./CategoryCounter.js";
import { CompletionRing } from "./CompletionRing.js";
import { CATEGORY_LABELS, STATUS_LEGEND } from "@culinaire/shared";
import type { StockTakeCategory } from "../../hooks/useInventory.js";
import {
  Package, CheckCircle2, Play, Loader2, ArrowRight, Sparkles,
} from "lucide-react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

interface OpeningSession {
  sessionId: string;
  sessionStatus: string;
  categories: StockTakeCategory[];
}

// ─── Component ────────────────────────────────────────────────────

export function OpeningInventory() {
  const { selectedLocationId, refreshLocations } = useLocation();

  const [session, setSession] = useState<OpeningSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<StockTakeCategory | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  // ── Fetch active session ──────────────────────────────────────

  const refreshSession = useCallback(async () => {
    if (!selectedLocationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/stock-takes/active`, opts);
      if (res.ok) {
        const data = await res.json();
        if (data?.sessionStatus === "APPROVED") {
          setIsComplete(true);
          setSession(data);
        } else {
          setSession(data);
        }
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // ── Start opening count ───────────────────────────────────────

  const startOpeningCount = async () => {
    if (!selectedLocationId) return;
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(
        `${API}/locations/${selectedLocationId}/opening-count`,
        { ...jsonOpts, method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to start opening inventory");
      }
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  // ── Claim category ────────────────────────────────────────────

  const claimCategory = async (categoryId: string) => {
    if (!session) return;
    try {
      const res = await fetch(
        `${API}/stock-takes/${session.sessionId}/categories/${categoryId}/claim`,
        { ...jsonOpts, method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to claim category");
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Submit for review (auto-approve for OPENING) ──────────────

  const submitAll = async () => {
    if (!session) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/stock-takes/${session.sessionId}/submit-for-review`,
        { ...jsonOpts, method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to submit opening inventory");
      }
      setIsComplete(true);
      // Refresh locations so inventoryActive flips to true
      if (refreshLocations) await refreshLocations();
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Category counter callback ─────────────────────────────────

  const handleCategoryBack = () => {
    setActiveCategory(null);
    refreshSession();
  };

  // ── Helpers ───────────────────────────────────────────────────

  const getCategoryProgress = (cat: StockTakeCategory) => {
    if (!cat.lines || cat.lines.length === 0) return 0;
    const counted = cat.lines.filter(
      (l) => l.countedQty !== null && l.countedQty !== "",
    ).length;
    return counted / cat.lines.length;
  };

  const allCategoriesSubmitted =
    session?.categories?.every((c) => c.categoryStatus === "SUBMITTED") ?? false;

  // ── Active category counter ───────────────────────────────────

  if (activeCategory && session) {
    return (
      <CategoryCounter
        sessionId={session.sessionId}
        category={activeCategory}
        onBack={handleCategoryBack}
      />
    );
  }

  // ── Loading state ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-amber-400 animate-spin" />
      </div>
    );
  }

  // ── Celebration view ──────────────────────────────────────────

  if (isComplete) {
    return (
      <div className="text-center py-16 animate-[fadeInUp_400ms_ease-out]">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-amber-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(52,211,153,0.2)] animate-[pulse_2s_ease-in-out_infinite]">
          <Sparkles className="size-12 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Inventory Active!
        </h2>
        <p className="text-sm text-[#999] max-w-md mx-auto mb-8">
          Your opening inventory has been recorded. You can now track stock
          levels, run regular stock takes, and manage your inventory from the
          dashboard.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold text-sm hover:shadow-[0_0_16px_rgba(52,211,153,0.3)] transition-all active:scale-[0.98]"
        >
          Go to Dashboard
          <ArrowRight className="inline-block ml-2 size-4" />
        </button>
      </div>
    );
  }

  // ── No session — start button ─────────────────────────────────

  if (!session) {
    return (
      <div className="text-center py-16 animate-[fadeInUp_200ms_ease-out]">
        {/* Header bar */}
        <div className="mb-8 mx-auto max-w-lg rounded-2xl border-l-4 border-amber-500 bg-gradient-to-r from-amber-500/20 via-emerald-500/10 to-transparent p-6 backdrop-blur-md">
          <h2 className="text-xl font-bold text-white mb-1">
            Opening Inventory
          </h2>
          <p className="text-sm text-[#BBB]">
            Count every item to establish your baseline stock levels. This only
            needs to be done once per location.
          </p>
        </div>

        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-amber-500/20 to-emerald-500/10 flex items-center justify-center shadow-[0_0_20px_rgba(251,191,36,0.15)]">
          <Package className="size-10 text-amber-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Ready to Begin
        </h3>
        <p className="text-sm text-[#999] max-w-md mx-auto mb-8">
          Start your opening count to activate inventory tracking for this
          location. Every category will be included.
        </p>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <button
          onClick={startOpeningCount}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold text-sm hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
        >
          <Play className="inline-block mr-2 size-4" />
          Start Opening Inventory
        </button>
      </div>
    );
  }

  // ── Active session — category cards ───────────────────────────

  const categories = session.categories || [];

  return (
    <div className="animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="mb-6 rounded-2xl border-l-4 border-amber-500 bg-gradient-to-r from-amber-500/20 via-emerald-500/10 to-transparent p-5 backdrop-blur-md">
        <h2 className="text-xl font-bold text-white mb-1">
          Opening Inventory
        </h2>
        <p className="text-sm text-[#BBB]">
          Count each category to establish your baseline. Tap a category to
          start counting.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-400 mb-4 text-center">{error}</p>
      )}

      {/* Category grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {categories.map((cat, i) => {
          const progress = getCategoryProgress(cat);
          const isSubmitted = cat.categoryStatus === "SUBMITTED";
          const isClaimed = cat.categoryStatus === "IN_PROGRESS";
          const totalLines = cat.lines?.length ?? cat.lineCount ?? 0;
          const countedLines =
            cat.lines?.filter(
              (l) => l.countedQty !== null && l.countedQty !== "",
            ).length ?? 0;
          const label = `${countedLines}/${totalLines}`;
          const catLabel =
            CATEGORY_LABELS[cat.categoryName] || cat.categoryName;

          return (
            <div
              key={cat.categoryId}
              className={`
                group relative rounded-2xl border p-5 backdrop-blur-md
                transition-all duration-200
                ${
                  isSubmitted
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/20 bg-[#1A1A1A]/60 hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(251,191,36,0.1)]"
                }
              `}
              style={{
                animationDelay: `${i * 60}ms`,
                animation: "fadeInUp 300ms ease-out backwards",
              }}
            >
              <div className="flex items-center gap-4">
                <CompletionRing
                  progress={progress}
                  size={52}
                  strokeWidth={4}
                  label={label}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate">
                    {catLabel}
                  </h3>
                  <p className="text-xs text-[#888] mt-0.5">
                    {isSubmitted
                      ? "Submitted"
                      : isClaimed
                        ? "In progress"
                        : "Not started"}
                  </p>
                </div>

                {/* Action button */}
                {isSubmitted ? (
                  <CheckCircle2 className="size-5 text-emerald-400 shrink-0" />
                ) : isClaimed ? (
                  <button
                    onClick={() => setActiveCategory(cat)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      await claimCategory(cat.categoryId);
                      setActiveCategory(cat);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    Count
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit button — visible when all categories are submitted */}
      {allCategoriesSubmitted && (
        <div className="text-center animate-[fadeInUp_300ms_ease-out]">
          <button
            onClick={submitAll}
            disabled={isSubmitting}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold text-sm hover:shadow-[0_0_16px_rgba(52,211,153,0.3)] transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="inline-block mr-2 size-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <CheckCircle2 className="inline-block mr-2 size-4" />
                Complete Opening Inventory
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
