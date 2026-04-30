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
import { Search, Plus, Link2, Pencil, AlertTriangle } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface PickedIngredient {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  preferredUnitCost: string | null;
}

interface CatalogRow {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  preferredUnitCost: string | null;
  ingredientCategory: string | null;
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
}

export function IngredientPickerInline({
  linkedId,
  displayName,
  onPick,
  onTextChange,
  onCreateRequest,
  showUnlinkedBadge = true,
  disabled,
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
        const rows = (await res.json()) as Array<{
          ingredientId: string;
          ingredientName: string;
          baseUnit: string;
          preferredUnitCost: string | null;
          ingredientCategory: string | null;
        }>;
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
        </div>
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

      <div
        id="ingredient-picker-list"
        className="absolute z-30 left-0 right-0 mt-1 bg-[#161616] border border-[#2A2A2A] rounded-xl shadow-xl overflow-hidden max-h-[260px] overflow-y-auto"
      >
        {loading && (
          <div className="px-3 py-2 text-xs text-[#999]">Searching...</div>
        )}
        {!loading && results.length === 0 && query.trim().length > 0 && (
          <div className="px-3 py-2 text-xs text-[#999]">No matches.</div>
        )}
        {!loading && query.trim().length === 0 && (
          <div className="px-3 py-2 text-xs text-[#999]">
            Type to search the Catalog.
          </div>
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
              });
              setIsOpen(false);
              setQuery("");
            }}
            onMouseEnter={() => setHighlight(idx)}
            className={`w-full px-3 py-2 flex items-center gap-2 text-left text-sm transition-colors ${
              idx === highlight
                ? "bg-[#D4A574]/10 ring-1 ring-[#D4A574]/30"
                : "hover:bg-[#1E1E1E]"
            }`}
          >
            <Link2 className="size-3 text-emerald-400 shrink-0" aria-hidden />
            <span className="truncate text-[#FAFAFA]">{r.ingredientName}</span>
            <span className="ml-auto text-[10px] text-[#999] tabular-nums shrink-0">
              {r.preferredUnitCost
                ? `$${parseFloat(r.preferredUnitCost).toFixed(2)}/${r.baseUnit}`
                : `(${r.baseUnit})`}
            </span>
          </button>
        ))}

        {/* Create-new affordance — only if user typed something + no exact match */}
        {!loading && query.trim().length > 0 && !exactMatchExists && onCreateRequest && (
          <button
            type="button"
            onClick={() => onCreateRequest(query.trim())}
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm text-[#D4A574] border-t border-[#2A2A2A] bg-[#0F0F0F] hover:bg-[#1A1A1A] transition-colors"
          >
            <Plus className="size-3.5" />
            <span className="truncate">Add to Catalog: "{query.trim()}"</span>
          </button>
        )}
      </div>
    </div>
  );
}
