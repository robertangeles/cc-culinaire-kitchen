/**
 * @module components/inventory/BulkParEditor
 *
 * Set par levels across the catalogue in one pass.
 *
 * Order-to-par is invisible until pars exist: a fresh org has none, so every
 * suggested quantity reads zero and an order guide looks broken. This is the
 * surface that fixes that — type what you want on the shelf, save the lot.
 *
 * Honest about what it does: this speeds up DATA ENTRY for an operator who
 * already knows their pars. It does not invent them (usage-forecast suggestions
 * are P2, and need real depletion history to mean anything).
 */

import { useState, useMemo, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useLocationIngredients, type LocationIngredient } from "../../hooks/useInventory.js";
import { Search, Loader2, Gauge, Check } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";
/** Save in small batches so seeding a whole catalogue doesn't fire 60+ parallel writes. */
const BATCH_SIZE = 8;

/** The par actually in force: the location override, else the org default. */
function effectivePar(item: LocationIngredient): string | null {
  return item.parLevel ?? item.orgParLevel;
}

export default function BulkParEditor() {
  const { selectedLocationId } = useLocation();
  const { items, isLoading, refresh } = useLocationIngredients(selectedLocationId);

  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const withPar = useMemo(
    () => items.filter((i) => Number(effectivePar(i) ?? 0) > 0).length,
    [items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.ingredientName.toLowerCase().includes(q));
  }, [items, search]);

  /** Rows the operator actually changed — only these get written. */
  const changed = useMemo(() => {
    return Object.entries(drafts).filter(([ingredientId, value]) => {
      const item = items.find((i) => i.ingredientId === ingredientId);
      if (!item) return false;
      const trimmed = value.trim();
      if (trimmed === "") return false;
      return trimmed !== (effectivePar(item) ?? "");
    });
  }, [drafts, items]);

  const save = useCallback(async () => {
    if (!selectedLocationId || changed.length === 0) return;
    setIsSaving(true);
    setError(null);
    setSavedCount(null);

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < changed.length; i += BATCH_SIZE) {
      const batch = changed.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ([ingredientId, value]) => {
          try {
            const res = await fetch(
              `${API}/api/inventory/locations/${encodeURIComponent(selectedLocationId)}/ingredients/${encodeURIComponent(ingredientId)}`,
              {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ parLevel: value.trim() }),
              },
            );
            if (res.ok) ok += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        }),
      );
    }

    setIsSaving(false);
    setSavedCount(ok);
    if (failed > 0) {
      setError(
        `${failed} par${failed === 1 ? "" : "s"} couldn't be saved. The rest were saved — try those again.`,
      );
    }
    setDrafts({});
    await refresh();
  }, [selectedLocationId, changed, refresh]);

  if (!selectedLocationId) {
    return (
      <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-6 text-center">
        <p className="text-[#999] text-sm">Pick a location to set its par levels.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
      {/* Header + progress */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <Gauge className="size-4 text-[#D4A574]" />
          Par Levels
        </h3>
        <span className="text-xs text-[#999] shrink-0">
          <span className="text-[#D4A574] font-medium">{withPar}</span> of {items.length} set
        </span>
      </div>
      <p className="text-xs text-[#777] mb-3">
        How much you want on the shelf. Ordering uses this to work out what to buy — until
        it&apos;s set, suggested quantities stay at zero.
      </p>

      {items.length > 0 && (
        <div className="h-1 rounded-full bg-[#1A1A1A] mb-3 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#D4A574] to-[#C4956A] transition-all"
            style={{ width: `${Math.round((withPar / items.length) * 100)}%` }}
          />
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter items by name..."
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[#0A0A0A] text-white
            border border-[#2A2A2A] focus:border-[#D4A574]/40
            focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none placeholder:text-[#555]"
        />
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-[#999] text-sm flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading your items…
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[#999] text-sm">No items in this location&apos;s catalogue yet.</p>
          <p className="text-[#666] text-xs mt-1">Add items first, then set their pars here.</p>
        </div>
      ) : (
        <>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A]/50">
            <div className="sticky top-0 flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#666] bg-[#141414] border-b border-[#2A2A2A]">
              <div className="flex-1">Item</div>
              <div className="w-12 text-center">Unit</div>
              <div className="w-16 text-right">On hand</div>
              <div className="w-24 text-right">Par</div>
            </div>
            {filtered.map((item) => {
              const current = effectivePar(item);
              const draft = drafts[item.ingredientId];
              const value = draft !== undefined ? draft : (current ?? "");
              const isDirty = draft !== undefined && draft.trim() !== (current ?? "");
              return (
                <div
                  key={item.ingredientId}
                  className="flex items-center gap-3 px-3 py-2 border-b border-[#1A1A1A] last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-white text-sm truncate block">{item.ingredientName}</span>
                  </div>
                  <div className="w-12 text-center text-xs text-[#666]">{item.baseUnit}</div>
                  <div className="w-16 text-right text-xs text-[#999]">
                    {Number(item.currentQty ?? 0).toFixed(1)}
                  </div>
                  <div className="w-24">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={value}
                      aria-label={`Par level for ${item.ingredientName}`}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [item.ingredientId]: e.target.value }))
                      }
                      placeholder="—"
                      className={`w-full px-2 py-1 rounded-lg text-sm text-right bg-[#0A0A0A] text-white
                        border outline-none transition-all placeholder:text-[#555]
                        ${
                          isDirty
                            ? "border-[#D4A574]/50 shadow-[0_0_8px_rgba(212,165,116,0.15)]"
                            : "border-[#2A2A2A] focus:border-[#D4A574]/40"
                        }`}
                    />
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-6 text-center text-[#666] text-sm">
                Nothing matches “{search}”.
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="text-xs">
              {error ? (
                <span className="text-amber-400">{error}</span>
              ) : savedCount !== null ? (
                <span className="text-[#999] flex items-center gap-1.5">
                  <Check className="size-3.5 text-[#D4A574]" />
                  Saved {savedCount} par{savedCount === 1 ? "" : "s"}
                </span>
              ) : changed.length > 0 ? (
                <span className="text-[#999]">
                  {changed.length} change{changed.length === 1 ? "" : "s"} not saved yet
                </span>
              ) : null}
            </div>
            <button
              onClick={save}
              disabled={isSaving || changed.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
                hover:shadow-[0_0_12px_rgba(212,165,116,0.2)]
                disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save pars
            </button>
          </div>
        </>
      )}
    </div>
  );
}
