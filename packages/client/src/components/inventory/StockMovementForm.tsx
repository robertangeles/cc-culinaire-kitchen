/**
 * @module components/inventory/StockMovementForm
 *
 * "I carried 4 bottles from the Stock Room to the Bar."
 *
 * Recording that here changes NO stock — the bottles are still on site and
 * still sellable. That is the whole point: before this existed, the only way
 * to say "restocked the bar" was to log it as usage, which deducted the stock
 * at the move AND again when it sold, then showed the difference as phantom
 * yield variance.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  useStorageAreas,
  useStockMovements,
  useLocationIngredients,
  type LocationIngredient,
} from "../../hooks/useInventory.js";
import { ArrowRightLeft, Search, Check, Loader2, X, Boxes } from "lucide-react";

/**
 * Handed over when the operator arrives from the "that's a move, not usage"
 * guardrail. Carries the whole item rather than an id: the guardrail already
 * has it, so there is nothing to look up and no async gap to bridge.
 */
export interface MovementPrefill {
  item: LocationIngredient;
  quantity?: number;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function StockMovementForm({
  prefill,
}: {
  /** Set when the operator arrived here from the "that's a move, not usage" guardrail. */
  prefill?: MovementPrefill | null;
}) {
  const { selectedLocationId } = useLocation();
  const { areas, isLoading: areasLoading } = useStorageAreas(selectedLocationId);
  const { movements, recordMovement } = useStockMovements(selectedLocationId);
  const { items: locationItems } = useLocationIngredients(selectedLocationId);

  // Seeded straight from the prefill at mount — the form only mounts when the
  // Move tab opens, so arriving from the guardrail lands here with the item and
  // amount already answered. No effect syncing props into state.
  const [selectedItem, setSelectedItem] = useState<LocationIngredient | null>(prefill?.item ?? null);
  const [quantity, setQuantity] = useState(prefill?.quantity != null ? String(prefill.quantity) : "");
  const [searchQuery, setSearchQuery] = useState("");
  const [fromAreaId, setFromAreaId] = useState("");
  const [toAreaId, setToAreaId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return locationItems
      .filter((i) => i.activeInd !== false && i.ingredientName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [searchQuery, locationItems]);

  const unit = selectedItem?.unitOverride || selectedItem?.baseUnit || "";

  const clear = useCallback(() => {
    setSelectedItem(null);
    setQuantity("");
    setNotes("");
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedItem || !quantity || !fromAreaId || !toAreaId) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError("How much moved?");
      return;
    }
    if (fromAreaId === toAreaId) {
      setError("Pick two different areas");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await recordMovement({
        ingredientId: selectedItem.ingredientId,
        fromStorageAreaId: fromAreaId,
        toStorageAreaId: toAreaId,
        quantity: qty,
        unit,
        notes: notes.trim() || undefined,
      });
      setShowSuccess(true);
      clear();
      setTimeout(() => setShowSuccess(false), 1500);
    } catch (err: any) {
      setError(err.message || "Couldn't record that move");
    } finally {
      setSaving(false);
    }
  }, [selectedItem, quantity, fromAreaId, toAreaId, unit, notes, recordMovement, clear]);

  if (areasLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  // Moving between areas is meaningless until there are areas to move between.
  if (areas.length < 2) {
    return (
      <div className="text-center py-16 rounded-xl bg-[#161616] border border-[#2A2A2A]">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#D4A574]/10 border border-[#D4A574]/20 flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.1)]">
          <Boxes className="size-7 text-[#D4A574]" />
        </div>
        <h3 className="text-base font-semibold text-white mb-1">
          {areas.length === 0 ? "No areas yet" : "You need a second area"}
        </h3>
        <p className="text-sm text-[#888] max-w-sm mx-auto">
          {areas.length === 0
            ? "Set up Stock Room, Bar, or wherever you keep stock in Areas — then you can record what moves between them."
            : "A move needs somewhere to come from and somewhere to go. Add another area to get started."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showSuccess && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm animate-fade-in shadow-[0_0_16px_rgba(16,185,129,0.1)]">
          <Check size={16} />
          <span className="font-medium">Move recorded — site stock unchanged</span>
        </div>
      )}

      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-5 space-y-4">
        {/* Item */}
        {!selectedItem ? (
          <div>
            <label htmlFor="move-search" className="text-xs text-[#888] font-medium mb-1.5 block">
              What moved?
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
              <input
                id="move-search"
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
              />
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1 rounded-lg border border-[#2A2A2A] overflow-hidden">
                {searchResults.map((i) => (
                  <button
                    key={i.ingredientId}
                    onClick={() => {
                      setSelectedItem(i);
                      setSearchQuery("");
                      setTimeout(() => qtyRef.current?.focus(), 50);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#ccc] hover:bg-[#D4A574]/5 transition-colors"
                  >
                    <span>{i.ingredientName}</span>
                    <span className="text-[10px] text-[#666]">
                      {Number(i.currentQty ?? 0).toFixed(1)} {i.unitOverride || i.baseUnit} on site
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#D4A574]/5 border border-[#D4A574]/20">
            <span className="text-sm text-white font-medium">{selectedItem.ingredientName}</span>
            <button
              onClick={clear}
              aria-label="Choose a different item"
              className="text-[#666] hover:text-[#CCC] transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {selectedItem && (
          <>
            {/* Qty */}
            <div>
              <label htmlFor="move-qty" className="text-xs text-[#888] font-medium mb-1.5 block">
                How much?
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="move-qty"
                  ref={qtyRef}
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="0.0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-28 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white text-right placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
                />
                <span className="text-sm text-[#888]">{unit}</span>
              </div>
            </div>

            {/* From → To */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="move-from" className="text-xs text-[#888] font-medium mb-1.5 block">
                  From
                </label>
                <select
                  id="move-from"
                  value={fromAreaId}
                  onChange={(e) => setFromAreaId(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4A574]/30 transition-all"
                >
                  <option value="">Choose...</option>
                  {areas.map((a) => (
                    <option key={a.storageAreaId} value={a.storageAreaId}>
                      {a.areaName}
                    </option>
                  ))}
                </select>
              </div>
              <ArrowRightLeft size={14} className="text-[#D4A574] mb-2.5 flex-shrink-0" />
              <div className="flex-1">
                <label htmlFor="move-to" className="text-xs text-[#888] font-medium mb-1.5 block">
                  To
                </label>
                <select
                  id="move-to"
                  value={toAreaId}
                  onChange={(e) => setToAreaId(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4A574]/30 transition-all"
                >
                  <option value="">Choose...</option>
                  {areas
                    .filter((a) => a.storageAreaId !== fromAreaId)
                    .map((a) => (
                      <option key={a.storageAreaId} value={a.storageAreaId}>
                        {a.areaName}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="move-notes" className="text-xs text-[#888] font-medium mb-1.5 block">
                Note <span className="text-[#555]">(optional)</span>
              </label>
              <input
                id="move-notes"
                type="text"
                placeholder="Friday service restock..."
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
              />
            </div>

            {error && <p className="text-xs text-red-400/90">{error}</p>}

            <p className="text-[11px] text-[#666]">
              This doesn't change your stock — {selectedItem.ingredientName} stays on site until
              it's sold or wasted.
            </p>

            <button
              onClick={handleSubmit}
              disabled={saving || !quantity || !fromAreaId || !toAreaId}
              className="w-full sm:w-auto bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold rounded-xl px-6 py-2.5 text-sm transition-all hover:shadow-[0_0_20px_rgba(212,165,116,0.2)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Recording...
                </>
              ) : (
                "Record move"
              )}
            </button>
          </>
        )}
      </div>

      {/* Recent moves */}
      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-5">
        <p className="text-[10px] text-[#D4A574]/70 uppercase tracking-wider mb-2">Recent moves</p>
        {movements.length === 0 ? (
          <p className="text-xs text-[#555] text-center py-4">Nothing moved yet.</p>
        ) : (
          <div className="rounded-lg border border-[#1E1E1E] divide-y divide-[#2A2A2A]/30">
            {movements.slice(0, 10).map((m) => (
              <div key={m.stockMovementId} className="flex items-center gap-2 px-3 py-2 text-xs">
                <ArrowRightLeft size={11} className="text-[#D4A574] flex-shrink-0" />
                <span className="text-[#E5E5E5] tabular-nums">
                  {Number(m.quantity) % 1 === 0 ? Number(m.quantity) : Number(m.quantity).toFixed(1)}
                </span>
                <span className="text-[#666]">{m.unit}</span>
                <span className="text-[#CCC] flex-1 truncate">{m.ingredientName}</span>
                <span className="text-[#888] truncate">
                  {m.fromAreaName} → {m.toAreaName}
                </span>
                <span className="text-[#666] min-w-[4.5rem] text-right">{formatTime(m.movedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
