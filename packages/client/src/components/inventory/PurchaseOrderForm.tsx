/**
 * @module components/inventory/PurchaseOrderForm
 *
 * Create a new purchase order: select supplier, add line items
 * (search ingredient, qty, unit, cost), save as draft or submit.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
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
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierIngredientIds, setSupplierIngredientIds] = useState<Set<string> | null>(null);

  // Fetch ingredient IDs linked to the selected supplier
  useEffect(() => {
    if (!supplierId) {
      setSupplierIngredientIds(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/inventory/suppliers/${supplierId}/ingredient-ids`, {
          credentials: "include",
        });
        if (res.ok) {
          const ids: string[] = await res.json();
          setSupplierIngredientIds(new Set(ids));
        }
      } catch {
        setSupplierIngredientIds(null);
      }
    })();
  }, [supplierId]);

  // Available categories from the ingredient list (filtered by supplier if selected)
  const supplierFilteredIngredients = useMemo(() => {
    if (!supplierIngredientIds) return ingredients;
    return ingredients.filter((i) => supplierIngredientIds.has(i.ingredientId));
  }, [ingredients, supplierIngredientIds]);

  const categories = useMemo(() => {
    const cats = [...new Set(supplierFilteredIngredients.map((i) => i.ingredientCategory))].sort();
    return cats;
  }, [supplierFilteredIngredients]);

  const CATEGORY_LABELS: Record<string, string> = {
    proteins: "Proteins",
    dairy: "Dairy",
    produce: "Produce",
    dry_goods: "Dry Goods",
    beverages: "Beverages",
    frozen: "Frozen",
    bakery: "Bakery",
    condiments: "Condiments",
    spirits: "Spirits",
    packaging: "Packaging",
    cleaning: "Cleaning",
    admin: "Admin",
    other: "Other",
  };

  // Filter ingredients: by category + search text, exclude already-added
  const addedIds = useMemo(() => new Set(lines.map((l) => l.ingredientId)), [lines]);

  const filteredIngredients = useMemo(() => {
    let result = supplierFilteredIngredients.filter((i) => !addedIds.has(i.ingredientId));

    // Category filter
    if (selectedCategory !== "all") {
      result = result.filter((i) => i.ingredientCategory === selectedCategory);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.ingredientName.toLowerCase().includes(q));
    }

    return result;
  }, [ingredients, addedIds, selectedCategory, search]);

  const addLine = useCallback((ing: LocationIngredient) => {
    // Duplicate guard
    if (lines.some((l) => l.ingredientId === ing.ingredientId)) return;
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

        {/* Category tabs + search */}
        <div className="space-y-3 mb-3">
          {/* Category pills */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedCategory === "all"
                  ? "bg-[#D4A574]/20 text-[#D4A574] border border-[#D4A574]/30"
                  : "bg-[#1A1A1A] text-[#999] border border-transparent hover:text-white"
              }`}
            >
              All ({supplierFilteredIngredients.filter(i => !addedIds.has(i.ingredientId)).length})
            </button>
            {categories.map((cat) => {
              const count = supplierFilteredIngredients.filter(
                (i) => i.ingredientCategory === cat && !addedIds.has(i.ingredientId),
              ).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedCategory === cat
                      ? "bg-[#D4A574]/20 text-[#D4A574] border border-[#D4A574]/30"
                      : "bg-[#1A1A1A] text-[#999] border border-transparent hover:text-white"
                  }`}
                >
                  {CATEGORY_LABELS[cat] ?? cat} ({count})
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter items by name..."
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[#1A1A1A] text-white
                border border-[#2A2A2A] focus:border-[#D4A574]/40
                focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] transition-all
                outline-none placeholder:text-[#555]"
            />
          </div>
        </div>

        {/* Browseable item list */}
        {filteredIngredients.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A]/50 mb-3">
            {/* Column headers */}
            <div className="sticky top-0 flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#666] bg-[#141414] border-b border-[#2A2A2A]">
              <div className="w-4 shrink-0" />
              <div className="flex-1">Item</div>
              <div className="w-12 text-center">UOM</div>
              <div className="w-14 text-right">Stock</div>
              <div className="w-14 text-right">Par</div>
              <div className="w-14 text-right">Min Ord</div>
              <div className="w-16 text-right">Unit Cost</div>
            </div>
            {filteredIngredients.map((ing) => {
              const stock = Number(ing.currentQty ?? 0);
              const par = Number(ing.parLevel ?? ing.orgParLevel ?? 0);
              const isLow = par > 0 && stock < par;
              return (
                <button
                  key={ing.ingredientId}
                  onClick={() => addLine(ing)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1E1E1E] transition-colors
                    border-b border-[#1A1A1A] last:border-0 flex items-center gap-3"
                >
                  <Plus className="size-4 text-[#D4A574] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-white text-sm">{ing.ingredientName}</span>
                  </div>
                  <div className="w-12 text-center text-xs text-[#666] shrink-0">
                    {ing.baseUnit}
                  </div>
                  <div className="w-14 text-right text-xs shrink-0">
                    <span className={isLow ? "text-amber-400 font-medium" : "text-[#999]"}>
                      {stock.toFixed(1)}
                    </span>
                  </div>
                  <div className="w-14 text-right text-xs text-[#555] shrink-0">
                    {par > 0 ? par.toFixed(1) : "—"}
                  </div>
                  <div className="w-14 text-right text-xs text-[#555] shrink-0">
                    {ing.reorderQty ? Number(ing.reorderQty).toFixed(1) : "—"}
                  </div>
                  <div className="w-16 text-right text-xs text-[#666] shrink-0">
                    {(ing.locationUnitCost || ing.orgUnitCost)
                      ? `$${Number(ing.locationUnitCost ?? ing.orgUnitCost).toFixed(2)}`
                      : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {filteredIngredients.length === 0 && search.trim() && (
          <p className="text-xs text-[#666] mb-3 text-center py-4">No items match your search.</p>
        )}

        {/* Lines */}
        {lines.length === 0 ? (
          <div className="text-center py-8 text-[#666] text-sm">
            Search and add items above
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              // Find the ingredient to get stock context
              const ing = ingredients.find((i) => i.ingredientId === line.ingredientId);
              const stock = Number(ing?.currentQty ?? 0);
              const par = Number(ing?.parLevel ?? ing?.orgParLevel ?? 0);

              return (
                <div
                  key={line.id}
                  className="rounded-lg bg-[#1A1A1A]/50 border border-[#222] p-3 animate-[fadeIn_150ms_ease-out]"
                >
                  {/* Item name + stock context + remove */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-white">{line.ingredientName}</div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs">
                        <span className={stock < par && par > 0 ? "text-amber-400" : "text-[#666]"}>
                          In stock: {stock.toFixed(1)} {line.orderedUnit}
                        </span>
                        {par > 0 && (
                          <span className="text-[#666]">Par: {par.toFixed(1)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => removeLine(line.id)}
                      className="p-1.5 rounded-lg text-[#666] hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  {/* Fields with labels */}
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Order Qty</label>
                      <input
                        type="number"
                        value={line.orderedQty}
                        onChange={(e) => updateLine(line.id, "orderedQty", e.target.value)}
                        min="0.01"
                        step="0.1"
                        className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#0A0A0A] text-white
                          border border-[#2A2A2A] focus:border-[#D4A574]/40
                          focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Unit</label>
                      <input
                        type="text"
                        value={line.orderedUnit}
                        onChange={(e) => updateLine(line.id, "orderedUnit", e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#0A0A0A] text-white
                          border border-[#2A2A2A] focus:border-[#D4A574]/40
                          focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Unit Cost ($)</label>
                      <input
                        type="number"
                        value={line.unitCost}
                        onChange={(e) => updateLine(line.id, "unitCost", e.target.value)}
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#0A0A0A] text-white
                          border border-[#2A2A2A] focus:border-[#D4A574]/40
                          focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none placeholder:text-[#555]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Line Total</label>
                      <div className="px-2 py-1.5 rounded-lg text-sm text-[#D4A574] font-medium bg-[#0A0A0A]/50 border border-transparent">
                        ${((Number(line.orderedQty) || 0) * (Number(line.unitCost) || 0)).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

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
            bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
            hover:shadow-[0_0_12px_rgba(212,165,116,0.2)]
            disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Save & Submit
        </button>
      </div>
    </div>
  );
}
