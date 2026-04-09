/**
 * @module components/inventory/TransferForm
 *
 * Form to initiate a new inter-location stock transfer.
 * Select destination, search items, set quantities, submit.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  useLocationIngredients,
  useTransfers,
  type LocationIngredient,
} from "../../hooks/useInventory.js";
import {
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  Loader2,
  ArrowRightLeft,
  MapPin,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────── */

interface TransferLineEntry {
  ingredientId: string;
  ingredientName: string;
  sentQty: string;
  sentUnit: string;
}

/* ── Component ────────────────────────────────────────────────── */

export default function TransferForm({ onClose }: { onClose: () => void }) {
  const { selectedLocationId, locations } = useLocation();
  const { items: locationItems, isLoading: itemsLoading } =
    useLocationIngredients(selectedLocationId);
  const { initiate } = useTransfers(selectedLocationId);

  const [toLocationId, setToLocationId] = useState("");
  const [lines, setLines] = useState<TransferLineEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Filter out current location from destination options
  const destinationOptions = (locations || []).filter(
    (loc: any) => loc.storeLocationId !== selectedLocationId,
  );

  // Filter items by search
  const activeItems = locationItems.filter((i) => i.activeInd !== false);
  const filteredItems = activeItems.filter(
    (item) =>
      item.ingredientName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !lines.some((l) => l.ingredientId === item.ingredientId),
  );

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus();
  }, [showSearch]);

  function addItem(item: LocationIngredient) {
    setLines((prev) => [
      ...prev,
      {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        sentQty: "",
        sentUnit: item.unitOverride || item.baseUnit,
      },
    ]);
    setSearchQuery("");
    setShowSearch(false);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQty(idx: number, qty: string) {
    setLines((prev) =>
      prev.map((line, i) => (i === idx ? { ...line, sentQty: qty } : line)),
    );
  }

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!toLocationId) {
      setError("Select a destination location");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one item");
      return;
    }
    const invalidLines = lines.filter((l) => !l.sentQty || Number(l.sentQty) <= 0);
    if (invalidLines.length > 0) {
      setError("All items must have a quantity greater than 0");
      return;
    }

    setSaving(true);
    try {
      await initiate({
        fromLocationId: selectedLocationId!,
        toLocationId,
        lines: lines.map((l) => ({
          ingredientId: l.ingredientId,
          sentQty: Number(l.sentQty),
          sentUnit: l.sentUnit,
        })),
        notes: notes || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  }, [toLocationId, lines, notes, selectedLocationId, initiate, onClose]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-surface-2/50 border border-white/5 hover:border-amber-500/20 transition-colors"
        >
          <ArrowLeft size={18} className="text-zinc-400" />
        </button>
        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <ArrowRightLeft size={20} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">New Transfer</h2>
          <p className="text-xs text-zinc-500">Send stock to another location</p>
        </div>
      </div>

      {/* Destination selector */}
      <div className="p-4 rounded-xl bg-surface-2/40 border border-white/5 backdrop-blur-sm">
        <label className="block text-sm font-medium text-zinc-400 mb-2 flex items-center gap-2">
          <MapPin size={14} />
          Destination Location
        </label>
        <select
          value={toLocationId}
          onChange={(e) => setToLocationId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-white/10 text-zinc-100 text-sm focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-colors"
        >
          <option value="">Select location...</option>
          {destinationOptions.map((loc: any) => (
            <option key={loc.storeLocationId} value={loc.storeLocationId}>
              {loc.locationName}
            </option>
          ))}
        </select>
      </div>

      {/* Items list */}
      <div className="p-4 rounded-xl bg-surface-2/40 border border-white/5 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-zinc-400">Items to Transfer</span>
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 text-amber-400 text-xs font-medium hover:bg-amber-600/30 transition-colors"
          >
            <Plus size={14} />
            Add Item
          </button>
        </div>

        {/* Search dropdown */}
        {showSearch && (
          <div className="mb-3 relative">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-1 border border-amber-500/30 text-zinc-100 text-sm focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 shadow-[0_0_8px_rgba(255,214,10,0.1)] transition-all"
              />
            </div>
            {searchQuery && (
              <div className="absolute z-10 w-full mt-1 max-h-48 overflow-y-auto rounded-lg bg-surface-1 border border-white/10 shadow-xl">
                {filteredItems.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-zinc-500">No items found</p>
                ) : (
                  filteredItems.slice(0, 10).map((item) => (
                    <button
                      key={item.ingredientId}
                      onClick={() => addItem(item)}
                      className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-amber-600/10 hover:text-zinc-100 transition-colors flex justify-between"
                    >
                      <span>{item.ingredientName}</span>
                      <span className="text-xs text-zinc-500">{item.baseUnit}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Line items */}
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">
            No items added yet
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div
                key={line.ingredientId}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-1/60 border border-white/5"
              >
                <span className="flex-1 text-sm text-zinc-200 truncate">
                  {line.ingredientName}
                </span>
                <input
                  type="number"
                  value={line.sentQty}
                  onChange={(e) => updateQty(idx, e.target.value)}
                  placeholder="Qty"
                  min="0.01"
                  step="0.01"
                  className="w-20 px-2 py-1 rounded-md bg-surface-2 border border-white/10 text-zinc-100 text-sm text-right focus:border-amber-500/40 transition-colors"
                />
                <span className="text-xs text-zinc-500 w-10">{line.sentUnit}</span>
                <button
                  onClick={() => removeLine(idx)}
                  className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="p-4 rounded-xl bg-surface-2/40 border border-white/5 backdrop-blur-sm">
        <label className="block text-sm font-medium text-zinc-400 mb-2">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Urgent request for weekend service"
          className="w-full px-3 py-2 rounded-lg bg-surface-1 border border-white/10 text-zinc-100 text-sm focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-colors resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-600/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-accent to-amber-600 text-zinc-950 font-semibold hover:shadow-[0_0_16px_rgba(255,214,10,0.3)] hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {saving ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <ArrowRightLeft size={18} />
        )}
        Initiate Transfer
      </button>
    </div>
  );
}
