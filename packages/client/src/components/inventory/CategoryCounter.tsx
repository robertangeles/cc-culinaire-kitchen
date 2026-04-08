/**
 * @module components/inventory/CategoryCounter
 *
 * Mobile-optimized counting interface for a single stock take category.
 * Features: ingredient list with quantities, smart numeric keypad,
 * "copy last count" pre-fill, and per-item attribution.
 *
 * Design: one-handed phone operation — large tap targets, bottom-anchored keypad.
 */

import { useState, useEffect, useCallback } from "react";
import {
  useStockTake, useLocationIngredients,
  type StockTakeCategory, type StockTakeLine, type LocationIngredient,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import { useOfflineSync } from "../../hooks/useOfflineSync.js";
import { SmartKeypad } from "./SmartKeypad.js";
import { ArrowLeft, Check, User, Copy, Loader2, WifiOff, RefreshCw } from "lucide-react";

interface Props {
  sessionId: string;
  category: StockTakeCategory;
  onBack: () => void;
}

export function CategoryCounter({ sessionId, category, onBack }: Props) {
  const { selectedLocationId } = useLocation();
  const { saveLine, getLines, getPreviousLines } = useStockTake();
  const { items: locationIngredients } = useLocationIngredients(selectedLocationId);
  const { isOnline, queueSize, isSyncing, saveWithOfflineFallback, syncQueue } = useOfflineSync();

  const [lines, setLines] = useState<StockTakeLine[]>([]);
  const [activeIngredient, setActiveIngredient] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter ingredients for this category
  const categoryIngredients = locationIngredients.filter(
    (i) => (i.categoryOverride || i.ingredientCategory) === category.categoryName
      && i.activeInd !== false,
  );

  // Load existing lines
  const loadLines = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getLines(sessionId, category.categoryName);
      setLines(data);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, category.categoryName, getLines]);

  useEffect(() => { loadLines(); }, [loadLines]);

  // Copy last count pre-fill
  const handleCopyLastCount = useCallback(async () => {
    try {
      const prev = await getPreviousLines(sessionId, category.categoryName);
      if (prev.length === 0) {
        setError("No previous count data available");
        return;
      }
      // Save each previous line as a new count
      for (const line of prev) {
        await saveLine(sessionId, category.categoryName, {
          ingredientId: line.ingredientId,
          rawQty: Number(line.rawQty),
          countedUnit: line.countedUnit,
        });
      }
      await loadLines();
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [sessionId, category.categoryName, getPreviousLines, saveLine, loadLines]);

  // Save a count — with offline fallback
  const handleSave = useCallback(async (ingredientId: string, qty: number, unit: string) => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await saveWithOfflineFallback(sessionId, category.categoryName, {
        ingredientId, rawQty: qty, countedUnit: unit,
      });
      if (result.saved === "offline") {
        setError("Saved offline — will sync when connected");
      }
      await loadLines();
      // Move to next uncounted ingredient
      const currentIdx = categoryIngredients.findIndex((i) => i.ingredientId === ingredientId);
      const nextUncounted = categoryIngredients.find((i, idx) =>
        idx > currentIdx && !lines.some((l) => l.ingredientId === i.ingredientId),
      );
      setActiveIngredient(nextUncounted?.ingredientId ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, category.categoryName, saveLine, loadLines, categoryIngredients, lines]);

  // Get counted qty for an ingredient
  const getCountedQty = (ingredientId: string): string | null => {
    const line = lines.find((l) => l.ingredientId === ingredientId);
    return line ? line.rawQty : null;
  };

  const countedCount = lines.length;
  const totalCount = categoryIngredients.length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-[#D4A574] animate-spin" />
      </div>
    );
  }

  // Active ingredient keypad mode
  if (activeIngredient) {
    const ing = categoryIngredients.find((i) => i.ingredientId === activeIngredient);
    if (!ing) return null;
    const existingQty = getCountedQty(activeIngredient);

    return (
      <div className="animate-[fadeIn_150ms_ease-out]">
        <button
          onClick={() => setActiveIngredient(null)}
          className="flex items-center gap-1.5 text-sm text-[#999] hover:text-white mb-4 transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to list
        </button>

        <div className="text-center mb-6">
          <h3 className="text-lg font-semibold text-white">{ing.ingredientName}</h3>
          <p className="text-xs text-[#999] mt-1">
            {ing.baseUnit} · {CATEGORY_LABELS[category.categoryName] || category.categoryName}
          </p>
          {existingQty && (
            <p className="text-xs text-[#D4A574] mt-1">Current count: {existingQty}</p>
          )}
        </div>

        {error && <p className="text-sm text-red-400 text-center mb-4">{error}</p>}

        <SmartKeypad
          unit={ing.unitOverride || ing.baseUnit}
          initialValue={existingQty ? Number(existingQty) : undefined}
          isSaving={isSaving}
          onSave={(qty) => handleSave(activeIngredient, qty, ing.unitOverride || ing.baseUnit)}
          onCancel={() => setActiveIngredient(null)}
        />
      </div>
    );
  }

  return (
    <div className="animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-[#999] hover:text-white transition-colors"
        >
          <ArrowLeft className="size-4" />
          Categories
        </button>
        <button
          onClick={handleCopyLastCount}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[#D4A574] bg-[#D4A574]/10 hover:bg-[#D4A574]/20 transition-colors"
        >
          <Copy className="size-3" />
          Copy Last Count
        </button>
      </div>

      {/* Offline banner */}
      {(!isOnline || queueSize > 0) && (
        <div className="flex items-center justify-between p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2">
            <WifiOff className="size-4 text-amber-400" />
            <span className="text-xs text-amber-400">
              {!isOnline
                ? "Offline — counts will sync when connected"
                : `${queueSize} item${queueSize !== 1 ? "s" : ""} waiting to sync`}
            </span>
          </div>
          {isOnline && queueSize > 0 && (
            <button
              onClick={() => syncQueue()}
              disabled={isSyncing}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
            >
              <RefreshCw className={`size-3 ${isSyncing ? "animate-spin" : ""}`} />
              Sync
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          {CATEGORY_LABELS[category.categoryName] || category.categoryName}
        </h3>
        {/* Progress ring */}
        <CategoryProgressRing counted={countedCount} total={totalCount} />
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Ingredient list */}
      {categoryIngredients.length === 0 ? (
        <p className="text-sm text-[#999] text-center py-8">
          No ingredients in this category. Add ingredients in the Ingredients tab.
        </p>
      ) : (
        <div className="space-y-2">
          {categoryIngredients.map((ing) => {
            const counted = getCountedQty(ing.ingredientId);
            const line = lines.find((l) => l.ingredientId === ing.ingredientId);
            return (
              <button
                key={ing.ingredientId}
                onClick={() => setActiveIngredient(ing.ingredientId)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all hover:-translate-y-0.5 ${
                  counted
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-[#161616] border-[#2A2A2A] hover:border-[#3A3A3A]"
                }`}
              >
                <div className="text-left">
                  <p className="text-sm font-medium text-white">{ing.ingredientName}</p>
                  <p className="text-xs text-[#999]">{ing.unitOverride || ing.baseUnit}</p>
                </div>
                <div className="text-right flex items-center gap-3">
                  {counted ? (
                    <>
                      <div>
                        <p className="text-sm font-semibold text-emerald-400">{counted}</p>
                        {line && (
                          <p className="text-[10px] text-[#666] flex items-center gap-1">
                            <User className="size-2.5" />
                            {new Date(line.countedDttm).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                      <Check className="size-4 text-emerald-400" />
                    </>
                  ) : (
                    <span className="text-xs text-[#666]">Tap to count</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  proteins: "Proteins", produce: "Produce", dairy: "Dairy",
  dry_goods: "Dry Goods", beverages: "Beverages", spirits: "Spirits",
  frozen: "Frozen", bakery: "Bakery", condiments: "Condiments", other: "Other",
};

/** Radial progress ring showing counted/total items. */
function CategoryProgressRing({ counted, total }: { counted: number; total: number }) {
  const pct = total > 0 ? (counted / total) * 100 : 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="#2A2A2A" strokeWidth="3" />
        <circle
          cx="22" cy="22" r={radius} fill="none"
          stroke={pct >= 100 ? "#34d399" : "#D4A574"}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="text-xs font-bold text-white">{counted}</span>
    </div>
  );
}
