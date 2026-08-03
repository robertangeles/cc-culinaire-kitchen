/**
 * @module components/inventory/IngredientPickerInline
 *
 * Catalog-spine Phase 1: inline ingredient chooser for menu-item editor rows.
 *
 * Behaviour:
 *   - Search input. Debounced 200ms. Hits GET /api/inventory/ingredients?search=...
 *   - Dropdown shows up to 8 catalog matches with name + base unit + preferred cost.
 *   - "+ Add to Catalog: <typed text>" appears below results when the typed text
 *     doesn't match an existing row.
 *   - Selecting a row collapses to a chip (name + small linked-icon) and calls
 *     onPick({ ingredientId, ingredientName, baseUnit, preferredUnitCost }).
 *   - Pre-linked rows (ingredientId already set) display the chip directly with
 *     a small "Change" affordance to re-open the picker.
 *
 * Keyboard model: Enter selects highlighted row, ↑/↓ navigate, Esc closes.
 *
 * The component is intentionally small. The Catalog browser experience
 * (filter chips, bulk select, full-screen modal) is a separate component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Link2, Pencil, AlertTriangle, RefreshCw } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface PickedIngredient {
  /** Content equivalence: 1 kitchen unit contains contentQty contentUnit (1 bottle = 750 ml). */
  contentQty?: string | null;
  contentUnit?: string | null;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  preferredUnitCost: string | null;
  /** Catalog WAC ($/kitchen unit) — the T10 fallback when no preferred cost is set. */
  unitCost: string | null;
  /** Purchase packaging (unit-resolver step 2): label + kitchen units per pack. */
  purchaseUnit?: string | null;
  packQty?: string | null;
  /** Density g/mL — the resolver's volume↔mass bridge. */
  densityGPerMl?: string | null;
  /** Catalog row's last update — cost provenance age in the recipe editor. */
  updatedDttm?: string | null;
}

interface CatalogRow {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  preferredUnitCost: string | null;
  unitCost: string | null;
  ingredientCategory: string | null;
  contentQty?: string | null;
  contentUnit?: string | null;
  purchaseUnit?: string | null;
  packQty?: string | null;
  densityGPerMl?: string | null;
  updatedDttm?: string | null;
}

interface IngredientPickerInlineProps {
  /** Currently linked Catalog ingredient (renders chip mode), if any. */
  linkedId?: string | null;
  /** Display name — chip text when linked, fallback for legacy free-text rows. */
  displayName: string;
  /** Called when user picks an existing Catalog row. */
  onPick: (picked: PickedIngredient) => void;
  /** Called when user types a name but doesn't pick — useful for legacy compat. */
  onTextChange?: (text: string) => void;
  /** Called when user clicks "+ Add to Catalog". The host opens a Create modal. */
  onCreateRequest?: (suggestedName: string) => void;
  /** Show a small amber "Unlinked" warning chip when linkedId is null. Default true. */
  showUnlinkedBadge?: boolean;
  /** Disable input — useful while parent is saving. */
  disabled?: boolean;
  /**
   * Phase 3: when true, render a small amber dot + Refresh icon on the chip
   * indicating the linked Catalog cost has changed since this row was last
   * priced. Calls onRefresh when the chef clicks the icon.
   */
  costStale?: boolean;
  /** Phase 3: handler invoked when chef clicks the Refresh affordance. */
  onRefresh?: () => void;
}

export function IngredientPickerInline({
  linkedId,
  displayName,
  onPick,
  onTextChange,
  onCreateRequest,
  showUnlinkedBadge = true,
  disabled,
  costStale = false,
  onRefresh,
}: IngredientPickerInlineProps) {
  // Picker is open (search + dropdown visible) vs. collapsed chip view.
  const [isOpen, setIsOpen] = useState(!linkedId && !displayName);
  const [query, setQuery] = useState(linkedId ? "" : displayName ?? "");
  const [results, setResults] = useState<CatalogRow[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced server query.
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const url = `${API}/api/inventory/ingredients?search=${encodeURIComponent(trimmed)}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          setResults([]);
          return;
        }
        const rows = (await res.json()) as CatalogRow[];
        setResults(rows.slice(0, 8));
        setHighlight(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [query, isOpen]);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Note: parent's free-text sync happens directly inside the input's onChange
  // below — using a useEffect here would loop because parent passes a fresh
  // arrow function for onTextChange on every render, which retriggers the
  // effect, which triggers the parent setState, which re-renders, etc.

  const exactMatchExists = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return false;
    return results.some((r) => r.ingredientName.toLowerCase() === t);
  }, [results, query]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = results[highlight];
        if (row) {
          onPick({
            ingredientId: row.ingredientId,
            ingredientName: row.ingredientName,
            baseUnit: row.baseUnit,
            preferredUnitCost: row.preferredUnitCost,
            unitCost: row.unitCost,
            contentQty: row.contentQty ?? null,
            contentUnit: row.contentUnit ?? null,
            purchaseUnit: row.purchaseUnit ?? null,
            packQty: row.packQty ?? null,
            densityGPerMl: row.densityGPerMl ?? null,
            updatedDttm: row.updatedDttm ?? null,
          });
          setIsOpen(false);
          setQuery("");
        } else if (onCreateRequest && query.trim()) {
          onCreateRequest(query.trim());
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [results, highlight, onPick, onCreateRequest, query],
  );

  // ── Chip mode (already linked) ──
  if (linkedId && !isOpen) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-[#FAFAFA] text-sm">
          <Link2 className="size-3.5 text-emerald-400 shrink-0" aria-hidden />
          <span className="truncate">{displayName || "(unnamed)"}</span>
          {costStale && (
            <span
              className="size-1.5 rounded-full bg-amber-400 shrink-0 ml-1"
              aria-label="Catalog cost has changed since this row was last priced"
              title="Catalog cost changed since last priced. Click Refresh to pull the new cost."
              data-testid="cost-stale-dot"
            />
          )}
        </div>
        {costStale && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={disabled}
            className="p-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Refresh cost from Catalog"
            title="Refresh cost from Catalog"
            data-testid="cost-refresh-btn"
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setQuery("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          disabled={disabled}
          className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#999999] hover:text-[#FAFAFA] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          aria-label="Change linked ingredient"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }

  // ── Unlinked legacy chip + open-picker affordance ──
  if (!isOpen) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setQuery(displayName ?? "");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          disabled={disabled}
          className="flex-1 flex items-center gap-2 px-3 py-2 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-left hover:border-[#D4A574]/40 hover:bg-[#252525] transition-colors text-sm"
        >
          {showUnlinkedBadge && (
            <AlertTriangle className="size-3.5 text-amber-400 shrink-0" aria-hidden />
          )}
          <span className="truncate text-[#FAFAFA]">
            {displayName || <span className="text-[#666]">Pick ingredient...</span>}
          </span>
          {showUnlinkedBadge && (
            <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
              Unlinked
            </span>
          )}
        </button>
      </div>
    );
  }

  // ── Open picker mode ──
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#666] pointer-events-none"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            // Sync to parent's free-text mirror (legacy compat) — direct call,
            // not useEffect, to avoid render-loop with parent's arrow function.
            if (onTextChange) onTextChange(v);
          }}
          onKeyDown={handleKey}
          placeholder="Search Catalog..."
          disabled={disabled}
          className="w-full pl-9 pr-3 py-2 bg-[#1E1E1E] border border-[#D4A574]/40 rounded-lg text-[#FAFAFA] text-sm placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/30"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="ingredient-picker-list"
        />
      </div>

      {(loading || query.trim().length > 0) && (
        <div
          id="ingredient-picker-list"
          className="absolute z-50 left-0 mt-1 min-w-[280px] w-max max-w-[400px] bg-[#161616]/95 backdrop-blur-xl border border-[#D4A574]/15 rounded-xl overflow-hidden max-h-[240px] overflow-y-auto"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(42,42,42,0.5)" }}
        >
          {loading && (
            <div className="px-3 py-2.5 text-xs text-[#999]">Searching...</div>
          )}
          {!loading && results.length === 0 && query.trim().length > 0 && (
            <div className="px-3 py-2.5 text-xs text-[#666]">No matches found.</div>
          )}
          {results.map((r, idx) => (
            <button
              key={r.ingredientId}
              type="button"
              onClick={() => {
                onPick({
                  ingredientId: r.ingredientId,
                  ingredientName: r.ingredientName,
                  baseUnit: r.baseUnit,
                  preferredUnitCost: r.preferredUnitCost,
                  unitCost: r.unitCost,
                  contentQty: r.contentQty ?? null,
                  contentUnit: r.contentUnit ?? null,
                  purchaseUnit: r.purchaseUnit ?? null,
                  packQty: r.packQty ?? null,
                  densityGPerMl: r.densityGPerMl ?? null,
                  updatedDttm: r.updatedDttm ?? null,
                });
                setIsOpen(false);
                setQuery("");
              }}
              onMouseEnter={() => setHighlight(idx)}
              className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors ${
                idx === highlight
                  ? "bg-[#D4A574]/12 border-l-2 border-l-[#D4A574]"
                  : "hover:bg-[#1E1E1E] border-l-2 border-l-transparent"
              }`}
            >
              <Link2 className="size-3 text-emerald-400 shrink-0" aria-hidden />
              <span className="truncate text-[#FAFAFA]">{r.ingredientName}</span>
              <span className="ml-auto text-[10px] text-[#999] tabular-nums shrink-0 pl-2">
                {(r.preferredUnitCost ?? r.unitCost)
                  ? `$${parseFloat((r.preferredUnitCost ?? r.unitCost)!).toFixed(2)}/${r.baseUnit}`
                  : r.baseUnit}
              </span>
            </button>
          ))}

          {!loading && query.trim().length > 0 && !exactMatchExists && onCreateRequest && (
            <button
              type="button"
              onClick={() => onCreateRequest(query.trim())}
              className="w-full px-3 py-2 flex items-center gap-2 text-left text-xs text-[#D4A574] border-t border-[#2A2A2A] bg-[#0F0F0F] hover:bg-[#1A1A1A] transition-colors"
            >
              <Plus className="size-3.5" />
              <span className="truncate">Add to Catalog: &ldquo;{query.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      )}

      {!loading && query.trim().length === 0 && isOpen && (
        <div
          className="absolute z-50 left-0 mt-1 min-w-[280px] bg-[#161616]/95 backdrop-blur-xl border border-[#2A2A2A] rounded-xl px-3 py-2.5 text-xs text-[#666]"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
        >
          Type to search the Catalog.
        </div>
      )}
    </div>
  );
}
