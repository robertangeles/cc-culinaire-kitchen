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
import { useOrderGuides, useOrderGuideItems } from "../../hooks/useOrderGuides.js";
import type { OrderGuideSummary, OrderGuideItemView } from "@culinaire/shared";
import { costForOrderedUnit } from "@culinaire/shared";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Search,
  Send,
  Save,
  Loader2,
  ShoppingCart,
  BookOpen,
  Sparkles,
} from "lucide-react";

/**
 * The number that belongs in the ORDER QTY field.
 *
 * That field is labelled with purchaseUnit (bag, case), so it takes packages.
 * suggestedOrderQty is the shortfall in the KITCHEN unit (kg, bottle) — using
 * it here orders packQty times too much: 25 kg of flour became "50 bag".
 */
function orderQtyFor(gi: OrderGuideItemView): number {
  return gi.suggestedPackages ?? gi.suggestedOrderQty;
}

/**
 * The number that belongs in the COST field, which is labelled
 * "$ per {orderedUnit}". Stored costs are per KITCHEN unit, so a packaged item
 * needs the pack cost — otherwise the order is understated AND receiving
 * divides the already-per-kg figure again, valuing stock at cost/packQty.
 */
function costFor(gi: OrderGuideItemView): string {
  if (gi.unitCost == null) return "";
  return String(gi.packUnitCost ?? gi.unitCost);
}

/** Same conversion for the catalogue fallback, whose costs are also per kitchen unit. */
function costForCatalogLine(
  ing: { locationUnitCost?: string | null; orgUnitCost?: string | null; packQty?: string | null; purchaseUnit?: string | null },
  orderedUnit: string,
): string {
  const base = ing.locationUnitCost ?? ing.orgUnitCost;
  if (base == null || base === "") return "";
  return String(
    costForOrderedUnit(
      Number(base),
      ing.packQty != null ? Number(ing.packQty) : null,
      ing.purchaseUnit ?? null,
      orderedUnit,
    ),
  );
}

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
  const [supplierIngredientIds, setSupplierIngredientIds] = useState<Set<string> | null>(null);

  // ── Order guides: the default way in ───────────────────────────
  // Picking a guide fills the draft from the operator's regular list with every
  // quantity already at par - on-hand, so the screen opens as a correct draft
  // instead of an empty form. The catalog below stays as the fallback.
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [pendingGuideApply, setPendingGuideApply] = useState(false);
  const { guides } = useOrderGuides(selectedLocationId);
  const { items: guideItems } = useOrderGuideItems(selectedGuideId, selectedLocationId);

  const guideItemById = useMemo(
    () => new Map(guideItems.map((g) => [g.ingredientId, g])),
    [guideItems],
  );

  const applyGuide = useCallback((guide: OrderGuideSummary) => {
    setSelectedGuideId(guide.orderGuideId);
    setSupplierId(guide.supplierId);
    setPendingGuideApply(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (!pendingGuideApply || guideItems.length === 0) return;
    setLines(
      guideItems.map((gi) => ({
        id: crypto.randomUUID(),
        ingredientId: gi.ingredientId,
        ingredientName: gi.ingredientName,
        // Already at par -> 0; the operator sees the row but it won't be ordered.
        orderedQty: String(orderQtyFor(gi)),
        orderedUnit: gi.purchaseUnit || gi.baseUnit,
        unitCost: costFor(gi),
      })),
    );
    setPendingGuideApply(false);
  }, [pendingGuideApply, guideItems]);

  /** Snap every guide-backed line to its par shortfall in one tap. */
  const orderEverythingToPar = useCallback(() => {
    setLines((prev) =>
      prev.map((l) => {
        const gi = guideItemById.get(l.ingredientId);
        return gi ? { ...l, orderedQty: String(orderQtyFor(gi)) } : l;
      }),
    );
  }, [guideItemById]);

  /** Snap one line back to its par shortfall. */
  const setLineToPar = useCallback(
    (lineId: string, ingredientId: string) => {
      const gi = guideItemById.get(ingredientId);
      if (!gi) return;
      setLines((prev) =>
        prev.map((l) => (l.id === lineId ? { ...l, orderedQty: String(orderQtyFor(gi)) } : l)),
      );
    },
    [guideItemById],
  );

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

  // Scope the picker to what this supplier actually sells.
  const supplierFilteredIngredients = useMemo(() => {
    if (!supplierIngredientIds) return ingredients;
    return ingredients.filter((i) => supplierIngredientIds.has(i.ingredientId));
  }, [ingredients, supplierIngredientIds]);

  // Filter ingredients: search text, exclude already-added
  const addedIds = useMemo(() => new Set(lines.map((l) => l.ingredientId)), [lines]);

  // Debounce the picker filter — otherwise every keystroke re-scans the whole
  // catalogue, which stutters once a location carries a few hundred items.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * The catalogue is the FALLBACK path and only ever appears on an explicit
   * search. Not on supplier selection: picking a guide sets the supplier, so
   * gating on it re-opened the whole matrix underneath the guide — the exact
   * thing this gate exists to prevent. Scoping the dump to one supplier still
   * leaves a dump.
   */
  const hasPickerIntent = search.trim().length > 0;

  const filteredIngredients = useMemo(() => {
    let result = supplierFilteredIngredients.filter((i) => !addedIds.has(i.ingredientId));

    // Search filter
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      result = result.filter((i) => i.ingredientName.toLowerCase().includes(q));
    }

    return result;
  }, [supplierFilteredIngredients, addedIds, debouncedSearch]);

  /**
   * Cap what actually goes into the DOM. The catalogue is the FALLBACK path now
   * (order guides are the primary surface), so narrowing by search is a better
   * trade than shipping a virtualiser dependency for a secondary screen.
   */
  const MAX_PICKER_ROWS = 100;
  const visibleIngredients = useMemo(
    () => filteredIngredients.slice(0, MAX_PICKER_ROWS),
    [filteredIngredients],
  );
  const hiddenIngredientCount = filteredIngredients.length - visibleIngredients.length;

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
        // Order in the purchase packaging (case/bag) when the item has one;
        // receiving converts to kitchen units at the boundary.
        orderedUnit: ing.purchaseUnit || ing.baseUnit,
        // Stored costs are per kitchen unit; this line is priced per ordered
        // unit. Same conversion the guide path uses.
        unitCost: costForCatalogLine(ing, ing.purchaseUnit || ing.baseUnit),
      },
    ]);
    setSearch("");
  }, []);

  const updateLine = useCallback((id: string, field: keyof LineItem, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  }, []);

  /**
   * Switching a line between the package and the kitchen unit must re-price it.
   * The cost field is labelled "$ per {orderedUnit}", so leaving the old number
   * behind changes what the line total means without changing what it says.
   */
  const changeLineUnit = useCallback(
    (id: string, unit: string, ing?: { locationUnitCost?: string | null; orgUnitCost?: string | null; packQty?: string | null; purchaseUnit?: string | null }) => {
      setLines((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, orderedUnit: unit, unitCost: ing ? costForCatalogLine(ing, unit) : l.unitCost }
            : l,
        ),
      );
    },
    [],
  );

  const removeLine = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const handleSave = useCallback(async (andSubmit: boolean) => {
    if (!selectedLocationId) return;
    if (!supplierId) { setError("Select a supplier"); return; }
    if (lines.length === 0) { setError("Add at least one item"); return; }

    // Guide rows already at par sit at 0 so the operator can still see and bump
    // them — they just don't become PO lines.
    const orderable = lines.filter((l) => (Number(l.orderedQty) || 0) > 0);
    if (orderable.length === 0) {
      setError("Nothing to order yet — set a quantity on at least one item");
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const po = await createPO({
        storeLocationId: selectedLocationId,
        supplierId,
        lines: orderable.map((l) => ({
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
          <label htmlFor="po-supplier" className="block text-xs text-[#999] mb-1">Supplier *</label>
          <select
            id="po-supplier"
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

      {/* Order guides — the default way in. Pick the regular list and the draft
          arrives already filled to par; the catalog below stays as the fallback. */}
      {guides.length > 0 && (
        <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <BookOpen className="size-4 text-[#D4A574]" />
              Order Guide
            </h3>
            {selectedGuideId && lines.length > 0 && (
              <button
                type="button"
                onClick={orderEverythingToPar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                  bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
                  shadow-[0_0_12px_rgba(212,165,116,0.25)] hover:brightness-110 transition-all"
              >
                <Sparkles className="size-3.5" />
                Order everything to par
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {guides.map((g) => {
              const active = g.orderGuideId === selectedGuideId;
              return (
                <button
                  key={g.orderGuideId}
                  type="button"
                  onClick={() => applyGuide(g)}
                  className={`px-3 py-2 rounded-xl text-left transition-all border ${
                    active
                      ? "bg-[#D4A574]/15 border-[#D4A574]/40 shadow-[0_0_10px_rgba(212,165,116,0.15)]"
                      : "bg-[#1A1A1A] border-[#2A2A2A] hover:border-[#3A3A3A]"
                  }`}
                >
                  <span
                    className={`block text-xs font-medium ${active ? "text-[#D4A574]" : "text-white"}`}
                  >
                    {g.name}
                  </span>
                  <span className="block text-[10px] text-[#777] mt-0.5">
                    {g.supplierName} · {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Add items */}
      <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
        <h3 className="text-sm font-medium text-white mb-3">Line Items</h3>

        {/* Search. Category pills used to sit here: nobody orders by browsing
            "Condiments" — you order from a supplier, off a list. Supplier scope
            plus type-to-find covers the fallback path. */}
        <div className="space-y-3 mb-3">
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

        {/* Browseable item list.
            Gated on intent. With no supplier and no search this table rendered
            the WHOLE catalogue — 63 rows whose Par / Min Ord / Unit Cost were
            all "—", because none of those resolve until a supplier or location
            item is in play. A wall of dashes reads as "this product has no
            data", which is the opposite of true and was the original complaint
            that kicked off this whole rework. The columns are worth showing;
            showing them empty, unprompted, is not. */}
        {hasPickerIntent && filteredIngredients.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A]/50 mb-3">
            {/* Column headers */}
            <div className="sticky top-0 flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#666] bg-[#141414] border-b border-[#2A2A2A]">
              <div className="w-4 shrink-0" />
              <div className="flex-1">Item</div>
              <div className="w-12 text-center">UOM</div>
              <div className="w-14 text-right">Stock</div>
              <div className="w-14 text-right">Par</div>
              {/* The supplier's REAL minimum_order_qty. This heading used to render
                  location_ingredient.reorder_qty (the internal reorder trigger), which
                  read as a supplier constraint and misled the buyer. */}
              <div className="w-14 text-right">Min Ord</div>
              <div className="w-16 text-right">Unit Cost</div>
            </div>
            {visibleIngredients.map((ing) => {
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
                    {ing.supplierMinOrderQty ? Number(ing.supplierMinOrderQty).toFixed(1) : "—"}
                  </div>
                  <div className="w-16 text-right text-xs text-[#666] shrink-0">
                    {(ing.locationUnitCost || ing.orgUnitCost)
                      ? `$${Number(ing.locationUnitCost ?? ing.orgUnitCost).toFixed(2)}`
                      : "—"}
                  </div>
                </button>
              );
            })}
            {hiddenIngredientCount > 0 && (
              <p className="px-3 py-2 text-[11px] text-[#666] text-center border-t border-[#1A1A1A]">
                +{hiddenIngredientCount} more — keep typing to narrow it down
              </p>
            )}
          </div>
        )}
        {hasPickerIntent && filteredIngredients.length === 0 && search.trim() && (
          <p className="text-xs text-[#666] mb-3 text-center py-4">No items match your search.</p>
        )}

        {/* Lines */}
        {lines.length === 0 ? (
          <div className="text-center py-8 text-sm">
            {guides.length > 0 ? (
              <>
                <p className="text-[#999]">Pick a guide above to fill this order to par.</p>
                <p className="text-[#666] text-xs mt-1">
                  Or choose a supplier and search to build it by hand.
                </p>
              </>
            ) : (
              <p className="text-[#666]">Choose a supplier, or search for an item to add.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              // Find the ingredient to get stock context
              const ing = ingredients.find((i) => i.ingredientId === line.ingredientId);
              // A guide line carries the location's authoritative on-hand/par
              // (the server resolved loc -> org fallback already), so prefer it
              // and don't render a second copy of the same two numbers below.
              const gLine = guideItemById.get(line.ingredientId);
              const stock = Number(gLine?.onHand ?? ing?.currentQty ?? 0);
              const par = Number(gLine?.parLevel ?? ing?.parLevel ?? ing?.orgParLevel ?? 0);

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
                          In stock: {stock.toFixed(1)} {ing?.baseUnit ?? ""}
                        </span>
                        {par > 0 && (
                          <span className="text-[#666]">Par: {par.toFixed(1)}</span>
                        )}
                        {par > 0 && stock < par && (
                          <span className="text-[#D4A574]">below par</span>
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
                      <div className="flex gap-1">
                        <input
                          type="number"
                          value={line.orderedQty}
                          onChange={(e) => updateLine(line.id, "orderedQty", e.target.value)}
                          min="0"
                          step="0.1"
                          className="w-full min-w-0 px-2 py-1.5 rounded-lg text-sm bg-[#0A0A0A] text-white
                            border border-[#2A2A2A] focus:border-[#D4A574]/40
                            focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none"
                        />
                        {guideItemById.has(line.ingredientId) && (
                          <button
                            type="button"
                            onClick={() => setLineToPar(line.id, line.ingredientId)}
                            title={`Set to par (${orderQtyFor(guideItemById.get(line.ingredientId)!)} ${line.orderedUnit})`}
                            className="shrink-0 px-2 rounded-lg text-[10px] font-semibold tracking-wide
                              text-[#D4A574] border border-[#D4A574]/30 bg-[#D4A574]/10
                              hover:bg-[#D4A574]/20 transition-all"
                          >
                            TO PAR
                          </button>
                        )}
                      </div>
                      {(() => {
                        const gi = guideItemById.get(line.ingredientId);
                        if (!gi) return null;
                        const qty = Number(line.orderedQty) || 0;
                        // The supplier's real minimum_order_qty — warn, don't block:
                        // the operator may knowingly under-order and take the call.
                        const belowMin =
                          gi.supplierMinOrderQty != null && qty > 0 && qty < gi.supplierMinOrderQty;
                        // On-hand / par / below-par already read on the header
                        // line above — don't print them twice.
                        return belowMin ? (
                          <p className="mt-0.5 text-[10px] text-amber-400">
                            Supplier minimum is {gi.supplierMinOrderQty}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Unit</label>
                      <select
                        value={line.orderedUnit}
                        onChange={(e) => changeLineUnit(line.id, e.target.value, ing)}
                        className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#0A0A0A] text-white
                          border border-[#2A2A2A] focus:border-[#D4A574]/40
                          focus:shadow-[0_0_8px_rgba(212,165,116,0.12)] outline-none"
                      >
                        {/* Purchase packaging first (case of 12), then the kitchen unit */}
                        {ing?.purchaseUnit && (
                          <option value={ing.purchaseUnit}>
                            {ing.purchaseUnit}{ing.packQty ? ` (${Number(ing.packQty)} ${ing.baseUnit})` : ""}
                          </option>
                        )}
                        <option value={ing?.baseUnit ?? line.orderedUnit}>{ing?.baseUnit ?? line.orderedUnit}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Cost ($ per {line.orderedUnit || "unit"})</label>
                      <input
                        type="number"
                        value={line.unitCost}
                        onChange={(e) => updateLine(line.id, "unitCost", e.target.value)}
                        min="0"
                        step="any"
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
