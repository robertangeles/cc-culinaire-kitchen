/**
 * @module components/inventory/PurchaseOrderForm
 *
 * Create a new purchase order: select supplier, add line items
 * (search ingredient, qty, unit, cost), save as draft or submit.
 */

import { useState, useCallback, useMemo } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  useLocationIngredients,
  useSuppliers,
  usePurchaseOrders,
  type LocationIngredient,
} from "../../hooks/useInventory.js";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  Send,
  Save,
  Loader2,
  ShoppingCart,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────── */

interface LineItem {
  id: string; // client-side key
  ingredientId: string;
  ingredientName: string;
  orderedQty: string;
  orderedUnit: string;
  unitCost: string;
}

interface Props {
  onBack: () => void;
  onCreated: () => void;
}

/* ── Component ────────────────────────────────────────────────── */

export default function PurchaseOrderForm({ onBack, onCreated }: Props) {
  const { selectedLocationId } = useLocation();
  const { items: ingredients } = useLocationIngredients(selectedLocationId);
  const { suppliers } = useSuppliers();
  const { createPO, submitPO } = usePurchaseOrders(selectedLocationId);

  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter ingredients for search, exclude already-added
  const addedIds = useMemo(() => new Set(lines.map((l) => l.ingredientId)), [lines]);
  const filteredIngredients = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return ingredients
      .filter((i) => !addedIds.has(i.ingredientId) && i.ingredientName.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, ingredients, addedIds]);

  const addLine = useCallback((ing: LocationIngredient) => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName,
        orderedQty: ing.reorderQty ?? "1",
        orderedUnit: ing.baseUnit,
        unitCost: ing.locationUnitCost ?? ing.orgUnitCost ?? "",
      },
    ]);
    setSearch("");
  }, []);

  const updateLine = useCallback((id: string, field: keyof LineItem, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleSave = useCallback(async (andSubmit: boolean) => {
    if (!selectedLocationId) return;
    if (!supplierId) { setError("Select a supplier"); return; }
    if (lines.length === 0) { setError("Add at least one item"); return; }

    setError(null);
    setIsSaving(true);
    try {
      const po = await createPO({
        storeLocationId: selectedLocationId,
        supplierId,
        lines: lines.map((l) => ({
          ingredientId: l.ingredientId,
          orderedQty: l.orderedQty,
          orderedUnit: l.orderedUnit,
          unitCost: l.unitCost || undefined,
        })),
        notes: notes || undefined,
        expectedDeliveryDate: expectedDate || undefined,
      });

      if (andSubmit && po.poId) {
        await submitPO(po.poId);
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }, [selectedLocationId, supplierId, lines, notes, expectedDate, createPO, submitPO, onCreated]);

  const totalCost = useMemo(() => {
    return lines.reduce((sum, l) => {
      const qty = Number(l.orderedQty) || 0;
      const cost = Number(l.unitCost) || 0;
      return sum + qty * cost;
    }, 0);
  }, [lines]);

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-[#999] hover:text-white hover:bg-[#1E1E1E] transition-all"
        >
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShoppingCart className="size-5 text-[#D4A574]" />
          New Purchase Order
        </h2>
      </div>

      {/* Supplier + date row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs text-[#999] mb-1">Supplier *</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm bg-[#1A1A1A] text-white
              border border-[#2A2A2A] focus:border-[#D4A574]/40
              focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] transition-all
              outline-none appearance-none"
          >
            <option value="">Select supplier...</option>
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.supplierName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[#999] mb-1">Expected delivery</label>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm bg-[#1A1A1A] text-white
              border border-[#2A2A2A] focus:border-[#D4A574]/40
              focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] transition-all outline-none"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-[#999] mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Special instructions, delivery notes..."
          className="w-full px-3 py-2 rounded-lg text-sm bg-[#1A1A1A] text-white
            border border-[#2A2A2A] focus:border-[#D4A574]/40
            focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] transition-all
            outline-none resize-none placeholder:text-[#555]"
        />
      </div>

      {/* Add items */}
      <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
        <h3 className="text-sm font-medium text-white mb-3">Line Items</h3>

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items to add..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[#1A1A1A] text-white
              border border-[#2A2A2A] focus:border-[#D4A574]/40
              focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] transition-all
              outline-none placeholder:text-[#555]"
          />
          {/* Dropdown */}
          {filteredIngredients.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 z-20 rounded-lg bg-[#1E1E1E] border border-[#2A2A2A] shadow-dark-lg max-h-48 overflow-y-auto">
              {filteredIngredients.map((ing) => (
                <button
                  key={ing.ingredientId}
                  onClick={() => addLine(ing)}
                  className="w-full text-left px-3 py-2 text-sm text-[#CCC] hover:bg-[#2A2A2A] hover:text-white transition-colors flex items-center justify-between"
                >
                  <span>{ing.ingredientName}</span>
                  <span className="text-xs text-[#666]">{ing.baseUnit}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lines */}
        {lines.length === 0 ? (
          <div className="text-center py-8 text-[#666] text-sm">
            Search and add items above
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-2 text-xs text-[#666] font-medium">
              <div className="col-span-4">Item</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-2">Unit</div>
              <div className="col-span-2">Unit cost</div>
              <div className="col-span-1 text-right">Total</div>
              <div className="col-span-1" />
            </div>

            {lines.map((line) => (
              <div
                key={line.id}
                className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded-lg
                  bg-[#1A1A1A]/50 border border-[#222] animate-[fadeIn_150ms_ease-out]"
              >
                <div className="col-span-4 text-sm text-white truncate">{line.ingredientName}</div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={line.orderedQty}
                    onChange={(e) => updateLine(line.id, "orderedQty", e.target.value)}
                    min="0.01"
                    step="0.1"
                    className="w-full px-2 py-1 rounded text-sm bg-[#0A0A0A] text-white
                      border border-[#2A2A2A] focus:border-[#D4A574]/40 outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    value={line.orderedUnit}
                    onChange={(e) => updateLine(line.id, "orderedUnit", e.target.value)}
                    className="w-full px-2 py-1 rounded text-sm bg-[#0A0A0A] text-white
                      border border-[#2A2A2A] focus:border-[#D4A574]/40 outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={line.unitCost}
                    onChange={(e) => updateLine(line.id, "unitCost", e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="$"
                    className="w-full px-2 py-1 rounded text-sm bg-[#0A0A0A] text-white
                      border border-[#2A2A2A] focus:border-[#D4A574]/40 outline-none placeholder:text-[#555]"
                  />
                </div>
                <div className="col-span-1 text-right text-xs text-[#999]">
                  ${((Number(line.orderedQty) || 0) * (Number(line.unitCost) || 0)).toFixed(2)}
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => removeLine(line.id)}
                    className="p-1 rounded text-[#666] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="flex justify-end pt-2 pr-2 border-t border-[#222]">
              <span className="text-sm font-medium text-white">
                Total: <span className="text-[#D4A574]">${totalCost.toFixed(2)}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => handleSave(false)}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-[#1E1E1E] text-white border border-[#2A2A2A]
            hover:border-[#3A3A3A] hover:shadow-[0_0_8px_rgba(255,255,255,0.05)]
            disabled:opacity-50 transition-all"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save as Draft
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-gradient-to-r from-amber-500 to-amber-600 text-[#0A0A0A]
            hover:shadow-[0_0_16px_rgba(245,158,11,0.3)]
            disabled:opacity-50 transition-all hover:-translate-y-0.5"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Save & Submit
        </button>
      </div>
    </div>
  );
}
