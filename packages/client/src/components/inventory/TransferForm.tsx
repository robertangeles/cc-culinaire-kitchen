/**
 * @module components/inventory/TransferForm
 *
 * Form to initiate a new inter-location stock transfer.
 * Shows source + destination stock levels, custom dark dropdown,
 * auto-focus on qty after adding items.
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
  ChevronDown,
  Package,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────── */

interface TransferLineEntry {
  ingredientId: string;
  ingredientName: string;
  sentQty: string;
  sentUnit: string;
  sourceStock: number;
}

/* ── Component ────────────────────────────────────────────────── */

export default function TransferForm({ onClose }: { onClose: () => void }) {
  const { selectedLocationId, locations, selectedLocation } = useLocation();
  const { items: locationItems } = useLocationIngredients(selectedLocationId);
  const { initiate } = useTransfers(selectedLocationId);

  const [toLocationId, setToLocationId] = useState("");
  const [lines, setLines] = useState<TransferLineEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showLocDropdown, setShowLocDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const locDropdownRef = useRef<HTMLDivElement>(null);

  // Destination items for stock comparison
  const { items: destItems } = useLocationIngredients(toLocationId || null);

  // Filter out current location from destination options
  const destinationOptions = (locations || []).filter(
    (loc: any) => loc.storeLocationId !== selectedLocationId,
  );

  const selectedDest = destinationOptions.find(
    (loc: any) => loc.storeLocationId === toLocationId,
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

  // Close location dropdown on outside click
  useEffect(() => {
    if (!showLocDropdown) return;
    function handleClick(e: MouseEvent) {
      if (locDropdownRef.current && !locDropdownRef.current.contains(e.target as Node)) {
        setShowLocDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showLocDropdown]);

  function addItem(item: LocationIngredient) {
    const sourceStock = Number(item.currentQty || 0);
    const newIdx = lines.length;
    setLines((prev) => [
      ...prev,
      {
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        sentQty: "",
        sentUnit: item.unitOverride || item.baseUnit,
        sourceStock,
      },
    ]);
    setSearchQuery("");
    setShowSearch(false);
    // Auto-focus the qty input after render
    setTimeout(() => {
      qtyRefs.current.get(newIdx)?.focus();
    }, 50);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateQty(idx: number, qty: string) {
    setLines((prev) =>
      prev.map((line, i) => (i === idx ? { ...line, sentQty: qty } : line)),
    );
  }

  function getDestStock(ingredientId: string): number | null {
    if (!toLocationId || !destItems.length) return null;
    const item = destItems.find((i) => i.ingredientId === ingredientId);
    return item ? Number(item.currentQty || 0) : 0;
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
      setError("Enter a quantity for each item");
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
    <div className="space-y-5 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-[#161616] border border-[#2A2A2A] hover:border-[#D4A574]/20 transition-colors"
        >
          <ArrowLeft size={18} className="text-[#999]" />
        </button>
        <div className="p-2 rounded-xl bg-[#D4A574]/10 border border-[#D4A574]/20">
          <ArrowRightLeft size={20} className="text-[#D4A574]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">New Transfer</h2>
          <p className="text-xs text-[#888]">
            From <span className="text-[#D4A574]">{selectedLocation?.locationName || "Current Location"}</span>
          </p>
        </div>
      </div>

      {/* Destination selector — custom dark dropdown */}
      <div className="p-4 rounded-xl bg-[#111]/80 border border-white/5 backdrop-blur-sm">
        <label className="block text-xs font-medium text-[#888] mb-2 flex items-center gap-1.5">
          <MapPin size={12} />
          Destination Location
        </label>
        <div ref={locDropdownRef} className="relative">
          <button
            onClick={() => setShowLocDropdown(!showLocDropdown)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-all ${
              toLocationId
                ? "bg-[#161616] border-[#D4A574]/20 text-white"
                : "bg-[#0A0A0A] border-[#2A2A2A] text-[#666]"
            }`}
          >
            <div className="flex items-center gap-2">
              {selectedDest ? (
                <>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: (selectedDest as any).colorAccent || "#D4A574" }}
                  />
                  <span>{(selectedDest as any).locationName}</span>
                </>
              ) : (
                <span>Select destination...</span>
              )}
            </div>
            <ChevronDown size={14} className={`text-[#666] transition-transform ${showLocDropdown ? "rotate-180" : ""}`} />
          </button>

          {showLocDropdown && (
            <div
              className="absolute z-20 w-full mt-1 rounded-xl overflow-hidden animate-[fadeIn_100ms_ease-out]"
              style={{
                background: "linear-gradient(135deg, rgba(22,20,18,0.98), rgba(12,11,10,0.99))",
                border: "1px solid rgba(212,165,116,0.15)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {destinationOptions.map((loc: any) => (
                <button
                  key={loc.storeLocationId}
                  onClick={() => {
                    setToLocationId(loc.storeLocationId);
                    setShowLocDropdown(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                    loc.storeLocationId === toLocationId
                      ? "bg-[#D4A574]/10 border-l-2 border-[#D4A574] text-white"
                      : "hover:bg-white/[0.04] border-l-2 border-transparent text-[#ccc]"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: loc.colorAccent || "#666" }}
                  />
                  <span>{loc.locationName}</span>
                  <span className="ml-auto text-[10px] text-[#666] uppercase">
                    {loc.classification}
                  </span>
                </button>
              ))}
              {destinationOptions.length === 0 && (
                <p className="px-3 py-3 text-xs text-[#666] text-center">No other locations available</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Item picker — category browse + search */}
      <div className="p-4 rounded-xl bg-[#111]/80 border border-white/5 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-[#888]">
            {showSearch ? "Select Items" : `Items to Transfer (${lines.length})`}
          </span>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              showSearch
                ? "bg-[#1E1E1E] text-white border-[#2A2A2A]"
                : "bg-[#D4A574]/10 text-[#D4A574] border-[#D4A574]/20 hover:bg-[#D4A574]/20"
            }`}
          >
            {showSearch ? (
              <><ArrowLeft size={12} /> Done</>
            ) : (
              <><Plus size={14} /> Add Items</>
            )}
          </button>
        </div>

        {/* Category browse picker */}
        {showSearch && (
          <div className="mb-3 space-y-2">
            {/* Filter input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter items..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white text-sm focus:outline-none focus:border-[#D4A574]/30 placeholder:text-[#555]"
              />
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-1">
              {(() => {
                const cats = [...new Set(filteredItems.map(i => i.ingredientCategory))].sort();
                return cats.map(cat => {
                  const catLabel = cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                  const count = filteredItems.filter(i => i.ingredientCategory === cat).length;
                  const isActive = !searchQuery; // show all when no filter
                  return (
                    <span key={cat} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.04] text-[#888] border border-white/5">
                      {catLabel} ({count})
                    </span>
                  );
                });
              })()}
            </div>

            {/* Item list grouped by category */}
            <div className="max-h-60 overflow-y-auto rounded-lg border border-[#1E1E1E] divide-y divide-[#1E1E1E]">
              {(() => {
                const grouped = new Map<string, LocationIngredient[]>();
                for (const item of filteredItems) {
                  const cat = item.ingredientCategory;
                  if (!grouped.has(cat)) grouped.set(cat, []);
                  grouped.get(cat)!.push(item);
                }
                if (grouped.size === 0) {
                  return <p className="px-3 py-4 text-xs text-[#666] text-center">No items match</p>;
                }
                return [...grouped.entries()].map(([cat, items]) => {
                  const catLabel = cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                  return (
                    <div key={cat}>
                      <div className="px-3 py-1.5 bg-white/[0.02] text-[10px] text-[#666] uppercase tracking-wider font-medium">
                        {catLabel}
                      </div>
                      {items.map(item => {
                        const stock = Number(item.currentQty || 0);
                        const alreadyAdded = lines.some(l => l.ingredientId === item.ingredientId);
                        return (
                          <button
                            key={item.ingredientId}
                            onClick={() => !alreadyAdded && addItem(item)}
                            disabled={alreadyAdded}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                              alreadyAdded
                                ? "text-[#555] bg-[#0A0A0A] cursor-default"
                                : "text-[#ccc] hover:bg-[#D4A574]/5 cursor-pointer"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {alreadyAdded ? (
                                <span className="w-4 h-4 rounded border border-emerald-500/40 bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-[10px]">✓</span>
                              ) : (
                                <span className="w-4 h-4 rounded border border-[#2A2A2A]" />
                              )}
                              <span className={alreadyAdded ? "line-through" : ""}>{item.ingredientName}</span>
                            </div>
                            <span className="text-[10px] text-[#888] tabular-nums">
                              {stock.toFixed(1)} {item.baseUnit}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Selected line items with qty inputs */}
        {!showSearch && lines.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-[#555]">
            <Package size={20} className="opacity-40" />
            <p className="text-xs">Tap "Add Items" to browse your stock</p>
          </div>
        )}
        {!showSearch && lines.length > 0 && (
          <div className="space-y-2">
            {lines.map((line, idx) => {
              const destStock = getDestStock(line.ingredientId);
              return (
                <div
                  key={line.ingredientId}
                  className="px-3 py-2.5 rounded-lg bg-[#0A0A0A]/60 border border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white truncate block">
                        {line.ingredientName}
                      </span>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] text-[#888]">
                          You have: <span className="text-emerald-400 font-medium">{line.sourceStock.toFixed(1)} {line.sentUnit}</span>
                        </span>
                        {destStock !== null && (
                          <span className="text-[10px] text-[#888]">
                            They have: <span className="text-sky-400 font-medium">{destStock.toFixed(1)} {line.sentUnit}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <input
                      ref={(el) => { if (el) qtyRefs.current.set(idx, el); }}
                      type="number"
                      value={line.sentQty}
                      onChange={(e) => updateQty(idx, e.target.value)}
                      placeholder="Qty"
                      min="0.01"
                      step="0.01"
                      className="w-20 px-2 py-1.5 rounded-md bg-[#161616] border border-[#2A2A2A] text-white text-sm text-right focus:outline-none focus:border-[#D4A574]/40 transition-colors"
                    />
                    <span className="text-xs text-[#666] w-8">{line.sentUnit}</span>
                    <button
                      onClick={() => removeLine(idx)}
                      className="p-1 rounded text-[#555] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="p-4 rounded-xl bg-[#111]/80 border border-white/5 backdrop-blur-sm">
        <label className="block text-xs font-medium text-[#888] mb-2">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Urgent request for weekend service"
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white text-sm focus:outline-none focus:border-[#D4A574]/30 transition-colors resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98] transition-all disabled:opacity-50"
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
