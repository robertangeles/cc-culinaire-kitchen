/**
 * @module components/inventory/IngredientCatalog
 *
 * Category sidebar + item table layout. Select a category on the left,
 * view items on the right. Click a row to open the edit modal.
 */

import { useState, useMemo } from "react";
import {
  useIngredients,
  useSuppliers,
  useLocationIngredients,
  useIngredientStock,
  useIngredientSuppliers,
  type Ingredient,
  type LocationIngredient,
  type IngredientStockLevel,
  type IngredientSupplierLink,
  type Supplier,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import {
  Plus, Search, Loader2, Utensils, X, Check,
  DollarSign, ChevronDown, ChevronRight, Package, Truck,
  AlertTriangle, Star, Trash2,
} from "lucide-react";
import { TransactionHistory } from "./TransactionHistory.js";
import { CATEGORIES, CATEGORY_LABELS, ITEM_TYPES, ITEM_TYPE_KEYS, FIFO_MODES, FIFO_DEFAULTS, getItemTypeStyle, getCategoriesForType, type ItemTypeKey, type FifoModeKey } from "@culinaire/shared";

const UNITS = [
  "kg", "g", "mg",
  "L", "mL", "tsp", "tbsp", "cup", "fl oz",
  "each", "dozen", "portion",
  "bottle", "can", "bag", "box", "case", "bunch",
];

/**
 * Units that ARE measurements (weight/volume). Items counted in these need no
 * "size" declaration — recipes convert g↔kg / mL↔L automatically. Counted
 * things (bottle, can, each…) may declare a size (1 bottle = 750 mL) so
 * recipes can measure out of them.
 */
const MEASURED_UNITS = ["kg", "g", "mg", "L", "mL", "tsp", "tbsp", "cup", "fl oz"];

const ALLERGEN_DEFS = [
  { key: "containsDairyInd" as const, label: "Dairy", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { key: "containsGlutenInd" as const, label: "Gluten", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { key: "containsNutsInd" as const, label: "Nuts", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { key: "containsShellfishInd" as const, label: "Shellfish", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { key: "containsEggsInd" as const, label: "Eggs", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { key: "isVegetarianInd" as const, label: "Veg", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
];

type AllergenKey = typeof ALLERGEN_DEFS[number]["key"];

function getStockStatus(locData?: LocationIngredient): "healthy" | "low" | "critical" | "none" {
  if (!locData?.currentQty || !locData?.parLevel) return "none";
  const ratio = Number(locData.currentQty) / Number(locData.parLevel);
  if (ratio <= 0.25) return "critical";
  if (ratio <= 0.75) return "low";
  return "healthy";
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  healthy: { text: "OK", className: "text-emerald-400" },
  low: { text: "Low", className: "text-amber-400" },
  critical: { text: "Crit", className: "text-red-400" },
  none: { text: "—", className: "text-[#666]" },
};

export function IngredientCatalog() {
  const { ingredients, isLoading, create, update, checkUsage, remove } = useIngredients();
  const { suppliers: allSuppliers } = useSuppliers();
  const { selectedLocationId } = useLocation();
  const { items: locItems } = useLocationIngredients(selectedLocationId);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [allergenFilter, setAllergenFilter] = useState<AllergenKey | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("proteins");
  const [editIngredient, setEditIngredient] = useState<Ingredient | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locMap = new Map<string, LocationIngredient>();
  for (const item of locItems) locMap.set(item.ingredientId, item);

  const availableCategories = typeFilter !== "all"
    ? getCategoriesForType(typeFilter as ItemTypeKey)
    : [...CATEGORIES];

  // Items filtered by type + search + allergen + status (but NOT category)
  const typeFiltered = useMemo(() => {
    return (ingredients || []).filter((i) => {
      if (typeFilter !== "all" && i.itemType !== typeFilter) return false;
      if (allergenFilter && !i[allergenFilter]) return false;
      if (search && !i.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter) {
        const loc = locMap.get(i.ingredientId);
        const qty = Number(loc?.currentQty || 0);
        const par = Number(loc?.parLevel || i.parLevel || 0);
        const ratio = par > 0 ? qty / par : 1;
        if (statusFilter === "low" && ratio > 0.75) return false;
        if (statusFilter === "critical" && ratio > 0.25) return false;
      }
      return true;
    });
  }, [ingredients, typeFilter, allergenFilter, search, statusFilter, locMap]);

  // Count items per category (respecting type filter but not category)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, { total: number; low: number; critical: number }> = {};
    for (const item of typeFiltered) {
      const cat = item.ingredientCategory;
      if (!counts[cat]) counts[cat] = { total: 0, low: 0, critical: 0 };
      counts[cat].total++;
      const loc = locMap.get(item.ingredientId);
      const qty = Number(loc?.currentQty || 0);
      const par = Number(loc?.parLevel || item.parLevel || 0);
      if (par > 0) {
        const ratio = qty / par;
        if (ratio <= 0.25) counts[cat].critical++;
        else if (ratio <= 0.75) counts[cat].low++;
      }
    }
    return counts;
  }, [typeFiltered, locMap]);

  // Items filtered by everything including selected category
  const filtered = useMemo(() => {
    return typeFiltered.filter((i) => {
      if (selectedCategory && i.ingredientCategory !== selectedCategory) return false;
      return true;
    });
  }, [typeFiltered, selectedCategory]);

  // Auto-select first available category when type filter changes
  const handleTypeFilterChange = (newType: string) => {
    setTypeFilter(newType);
    const cats = newType !== "all" ? getCategoriesForType(newType as ItemTypeKey) : [...CATEGORIES];
    if (cats.length > 0 && !cats.some((c) => c.key === selectedCategory)) {
      setSelectedCategory(cats[0].key);
    }
  };

  return (
    <div className="space-y-3 animate-[fadeInUp_200ms_ease-out]">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full pl-10 pr-4 py-1.5 rounded-lg bg-[#161616] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 transition-all"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => handleTypeFilterChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="KITCHEN_INGREDIENT">Kitchen</option>
          <option value="FOH_CONSUMABLE">FOH</option>
          <option value="OPERATIONAL_SUPPLY">Operational</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="low">Low</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={allergenFilter || ""}
          onChange={(e) => setAllergenFilter((e.target.value || null) as AllergenKey | null)}
          className="px-3 py-1.5 rounded-lg bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">Allergens</option>
          {ALLERGEN_DEFS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button
          onClick={() => { setShowAdd(true); setError(null); }}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Add
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-[#777]">
        <span className="uppercase tracking-wider text-[#555]">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>OK — stock above 75% of par</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>Low — stock between 25–75% of par</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <span>Critical — stock below 25% of par</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#555]" />
          <span>No par level set</span>
        </span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAdd && (
        <AddIngredientForm
          suppliers={allSuppliers}
          onSave={async (data, supplierLink) => {
            try {
              setError(null);
              const created = await create(data);
              if (supplierLink?.supplierId && created?.ingredientId) {
                await fetch(`/api/inventory/ingredients/${created.ingredientId}/suppliers`, {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    supplierId: supplierLink.supplierId,
                    costPerUnit: supplierLink.costPerUnit || undefined,
                    packCost: supplierLink.packCost || undefined,
                    preferredInd: true,
                  }),
                });
              }
              setShowAdd(false);
            } catch (err: any) { setError(err.message); }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      )}

      {/* Two-column layout: sidebar + table */}
      {!isLoading && (
        <div className="flex rounded-xl border border-[#1E1E1E] overflow-hidden max-h-[calc(100vh-280px)]">
          {/* Category sidebar */}
          <div className="flex-shrink-0 w-52 bg-[#0A0A0A] border-r border-[#1E1E1E] overflow-y-auto">
            {availableCategories.map((cat) => {
              const counts = categoryCounts[cat.key];
              const total = counts?.total || 0;
              const hasCritical = (counts?.critical || 0) > 0;
              const hasLow = (counts?.low || 0) > 0;
              const isActive = selectedCategory === cat.key;

              return (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-[#1E1E1E] text-white border-l-2 border-[#D4A574]"
                      : "text-[#888] hover:text-white hover:bg-[#161616] border-l-2 border-transparent"
                  }`}
                >
                  <span className="truncate">{cat.label}</span>
                  <span className="flex items-center gap-1.5 shrink-0 ml-2">
                    {hasCritical && <span className="size-1.5 rounded-full bg-red-400" />}
                    {!hasCritical && hasLow && <span className="size-1.5 rounded-full bg-amber-400" />}
                    <span className={`text-xs tabular-nums ${isActive ? "text-[#999]" : "text-[#555]"}`}>
                      {total}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Item table */}
          <div className="flex-1 min-w-0 bg-[#111] overflow-y-auto">
            {/* Table header */}
            <div className="sticky top-0 z-10 grid grid-cols-12 gap-1 px-4 py-1.5 text-[10px] text-[#666] uppercase tracking-wider border-b border-[#1E1E1E] bg-[#111]">
              <div className="col-span-4">Name</div>
              <div className="col-span-1">UOM</div>
              <div className="col-span-2 text-right">Cost</div>
              <div className="col-span-2 text-right">Stock</div>
              <div className="col-span-1 text-right">Par</div>
              <div className="col-span-2 text-right">Status</div>
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-12">
                <Utensils className="size-8 mx-auto text-[#D4A574] mb-3" />
                <p className="text-sm text-white font-medium mb-1">
                  {search ? "No matching items" : "No items in this category"}
                </p>
                <p className="text-xs text-[#999]">
                  {search ? "Try a different search." : "Add your first item."}
                </p>
              </div>
            )}

            {/* Rows */}
            {filtered.map((ing) => {
              const loc = locMap.get(ing.ingredientId);
              const status = getStockStatus(loc);
              const sl = STATUS_LABEL[status];
              const cost = loc?.locationUnitCost || ing.unitCost;
              // Kitchen-unit model: stock, par, and display all live in the
              // item's kitchen unit (baseUnit — bottle, g, each). No lens.
              const qty = loc?.currentQty ? Number(loc.currentQty) : null;
              const par = loc?.parLevel ? Number(loc.parLevel) : ing.parLevel ? Number(ing.parLevel) : null;
              const isLowStock = qty !== null && par !== null && par > 0 && qty / par <= 0.75;
              const fmtStock = (n: number) => (n % 1 === 0 ? n.toString() : n.toFixed(1));

              return (
                <button
                  key={ing.ingredientId}
                  onClick={() => setEditIngredient(ing)}
                  className="w-full grid grid-cols-12 gap-1 px-4 py-1.5 text-sm hover:bg-[#1A1A1A] cursor-pointer transition-colors text-left items-center"
                >
                  <div className="col-span-4 text-white truncate">{ing.ingredientName}</div>
                  <div className="col-span-1 text-[#666]">{ing.baseUnit}</div>
                  <div className="col-span-2 text-right text-[#999] font-mono tabular-nums">
                    {cost
                      ? `$${(ing.packQty ? (Number(cost) * Number(ing.packQty)).toFixed(2) : Number(cost).toFixed(2))}`
                      : "—"}
                  </div>
                  <div className={`col-span-2 text-right font-mono tabular-nums ${isLowStock ? "text-amber-400" : "text-white"}`}>
                    {qty !== null ? fmtStock(qty) : "—"}
                  </div>
                  <div className="col-span-1 text-right text-[#666] font-mono tabular-nums">
                    {par !== null ? fmtStock(par) : "—"}
                  </div>
                  <div className={`col-span-2 text-right text-xs font-medium ${sl.className}`}>
                    {sl.text}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-[#666] text-center">{filtered.length} items</p>

      {/* Edit modal */}
      {editIngredient && (
        <EditIngredientModal
          ingredient={editIngredient}
          onSave={async (data) => {
            try {
              setError(null);
              await update(editIngredient.ingredientId, data);
              setEditIngredient(null);
            } catch (err: any) {
              setError(err.message);
            }
          }}
          onDelete={async () => {
            try {
              setError(null);
              await remove(editIngredient.ingredientId);
              setEditIngredient(null);
            } catch (err: any) {
              setError(err.message);
            }
          }}
          onCheckUsage={() => checkUsage(editIngredient.ingredientId)}
          onClose={() => setEditIngredient(null)}
        />
      )}
    </div>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────

function EditIngredientModal({
  ingredient, onSave, onDelete, onCheckUsage, onClose,
}: {
  ingredient: Ingredient;
  onSave: (data: Partial<Ingredient>) => Promise<void>;
  onDelete: () => Promise<void>;
  onCheckUsage: () => Promise<Array<{ menuItemId: string; menuItemName: string }>>;
  onClose: () => void;
}) {
  const { levels } = useIngredientStock(ingredient.ingredientId);
  const { suppliers: ingSuppliers, assign, updateLink, removeLink } = useIngredientSuppliers(ingredient.ingredientId);
  const { suppliers: allSuppliers } = useSuppliers();
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupId, setNewSupId] = useState("");
  const [newSupCost, setNewSupCost] = useState("");
  const [newSupSku, setNewSupSku] = useState("");
  const [name, setName] = useState(ingredient.ingredientName);
  const [editItemType, setEditItemType] = useState<ItemTypeKey>((ingredient.itemType as ItemTypeKey) || "KITCHEN_INGREDIENT");
  const [editFifo, setEditFifo] = useState<FifoModeKey>((ingredient.fifoApplicable as FifoModeKey) || FIFO_DEFAULTS[(ingredient.itemType as ItemTypeKey) || "KITCHEN_INGREDIENT"]);
  const [cat, setCat] = useState(ingredient.ingredientCategory);
  // Kitchen unit — THE unit this item is counted/stocked in (g, mL, each, bottle).
  const [unit, setUnit] = useState(ingredient.baseUnit);
  // Content equivalence: 1 kitchen unit contains [contentQty] [contentUnit].
  const [contentQty, setContentQty] = useState(ingredient.contentQty || "");
  const [contentUnit, setContentUnit] = useState(ingredient.contentUnit || "");
  // Purchase packaging: bought as [purchaseUnit] of [packQty] kitchen units.
  const [purchaseUnit, setPurchaseUnit] = useState(ingredient.purchaseUnit || "");
  const [editPackQty, setEditPackQty] = useState(ingredient.packQty || "");
  const [desc, setDesc] = useState(ingredient.description || "");
  const packCostInit = ingredient.packQty && ingredient.unitCost
    ? (Number(ingredient.unitCost) * Number(ingredient.packQty)).toFixed(2)
    : ingredient.unitCost || "";
  const [cost, setCost] = useState(packCostInit);

  // Cost per kitchen unit: with packaging, the entered cost is per package
  // (÷ pack qty); buying loose, the entered cost IS per kitchen unit — a stale
  // pack qty must not divide it.
  const derivedUnitCost = purchaseUnit && editPackQty && cost && parseFloat(editPackQty) > 0
    ? (parseFloat(cost) / parseFloat(editPackQty)).toFixed(4)
    : cost || null;
  const [par, setPar] = useState(ingredient.parLevel || "");
  const [reorder, setReorder] = useState(ingredient.reorderQty || "");
  // Par/reorder can be ENTERED in kitchen units or purchase packages ("2 bags");
  // they are always STORED in kitchen units (stock comparisons need one unit).
  const [parEntryUnit, setParEntryUnit] = useState<"base" | "pack">("base");
  const [reorderEntryUnit, setReorderEntryUnit] = useState<"base" | "pack">("base");
  const packFactor = purchaseUnit && editPackQty && parseFloat(editPackQty) > 0 ? parseFloat(editPackQty) : null;
  const canEnterInPacks = packFactor !== null;
  /** Convert an entered par/reorder value to kitchen units for saving. */
  const toKitchen = (value: string, entryUnit: "base" | "pack"): string | null => {
    if (!value) return null;
    const n = parseFloat(value);
    if (isNaN(n)) return value;
    return entryUnit === "pack" && packFactor ? String(n * packFactor) : value;
  };
  /** Live translation line so there's never doubt about what gets saved. */
  const echoFor = (value: string, entryUnit: "base" | "pack"): string | null => {
    if (!packFactor || !value) return null;
    const n = parseFloat(value);
    if (isNaN(n) || n <= 0) return null;
    return entryUnit === "pack"
      ? `= ${n * packFactor} ${unit}`
      : `= ${(n / packFactor).toFixed(2)} ${purchaseUnit}`;
  };
  const parEcho = echoFor(par, parEntryUnit);
  const reorderEcho = echoFor(reorder, reorderEntryUnit);
  const editModalCategories = getCategoriesForType(editItemType);
  const [deleteConfirm, setDeleteConfirm] = useState<"idle" | "checking" | "blocked" | "confirm">("idle");
  const [usageList, setUsageList] = useState<Array<{ menuItemId: string; menuItemName: string }>>([]);
  const [allergens, setAllergens] = useState<Set<AllergenKey>>(
    new Set(ALLERGEN_DEFS.filter((a) => ingredient[a.key]).map((a) => a.key)),
  );
  const [saving, setSaving] = useState(false);

  const toggleAllergen = (key: AllergenKey) => {
    const next = new Set(allergens);
    if (next.has(key)) next.delete(key); else next.add(key);
    setAllergens(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex rounded-2xl bg-[#161616] border border-[#2A2A2A] shadow-2xl animate-[scaleIn_200ms_ease-out]"
      >
        {/* Left panel — edit form */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Edit Ingredient</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#2A2A2A] text-[#999] hover:text-white transition-all">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Item name" autoFocus
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
          />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="Description" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none resize-none" />

          {/* Item type selector */}
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Item Type</p>
            <div className="flex gap-2">
              {ITEM_TYPE_KEYS.map((tk) => {
                const its = ITEM_TYPES[tk];
                return (
                  <button key={tk} type="button"
                    onClick={() => {
                      setEditItemType(tk);
                      setEditFifo(FIFO_DEFAULTS[tk]);
                      const validCats = getCategoriesForType(tk);
                      if (!validCats.some((c) => c.key === cat)) {
                        setCat(validCats[0]?.key || "other");
                      }
                    }}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      editItemType === tk
                        ? `${its.bgClass} ${its.textClass} ${its.borderClass}`
                        : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
                    }`}
                  >
                    {its.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Allergen toggles */}
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Allergens</p>
            <div className="flex flex-wrap gap-1.5">
              {ALLERGEN_DEFS.map((a) => (
                <button key={a.key} type="button" onClick={() => toggleAllergen(a.key)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                    allergens.has(a.key) ? a.color : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A]"
                  }`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* FIFO mode */}
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">FIFO Mode</p>
            <select value={editFifo} onChange={(e) => setEditFifo(e.target.value as FifoModeKey)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              {(Object.keys(FIFO_MODES) as FifoModeKey[]).map((fk) => (
                <option key={fk} value={fk}>{FIFO_MODES[fk].label} — {FIFO_MODES[fk].description}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
                {editModalCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Counted in</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <p className="text-[10px] text-[#666] mt-1">How you count it at stocktake — bottles, kg, each. All stock numbers use this.</p>
            </div>
          </div>

          {/* "Bottle size: 750 mL" — the trade term for what one counted thing
              holds; lets recipes measure out of it. Hidden for measured kitchen
              units (kg/mL): those are already measurements. */}
          {!MEASURED_UNITS.includes(unit) && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">
                {["each", "dozen", "portion"].includes(unit) ? "Unit size" : `${unit} size`}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#999]">1 {unit} =</span>
                <input type="text" value={contentQty} onChange={(e) => setContentQty(e.target.value)}
                  placeholder="750"
                  className="w-24 px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
                <select value={contentUnit} onChange={(e) => setContentUnit(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
                  <option value="">unit…</option>
                  {MEASURED_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-[#666] mt-1">
                e.g. a 750 mL bottle — recipes can then pour by the mL and a 150 mL glass uses 0.2 {unit}s.
                Leave empty if recipes only ever use whole {unit}s.
              </p>
            </div>
          )}


          {/* Purchase packaging — exists ONLY at ordering + receiving */}
          <div className="rounded-xl border border-[#2A2A2A] bg-[#111]/70 p-3">
            <label className="block text-[10px] uppercase tracking-wider text-[#D4A574]/70 mb-1">Purchased as</label>
            <p className="text-[10px] text-[#666] mb-1.5">
              How the supplier delivers it — a case of 12, a 25 kg bag, or loose by the {unit}.
              Deliveries convert to {unit} the moment they're received.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
                <option value="">— by the {unit} —</option>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              {/* "of N <unit>" only makes sense when there IS a package (a case
                  of 12 bottles). Buying loose by the kitchen unit hides it. */}
              {purchaseUnit && (
                <>
                  <span className="text-xs text-[#999]">of</span>
                  <input type="text" value={editPackQty} onChange={(e) => setEditPackQty(e.target.value)}
                    placeholder="12"
                    className="w-20 px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
                  <span className="text-xs text-[#999]">{unit}</span>
                </>
              )}
              <span className="text-xs text-[#999]">@</span>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
                <input type="text" value={cost} onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  className="w-28 pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
              </div>
              <span className="text-[10px] text-[#666]">{purchaseUnit ? `per ${purchaseUnit}` : `per ${unit}`}</span>
            </div>
            {purchaseUnit && editPackQty && derivedUnitCost && (
              <p className="text-[10px] text-[#D4A574] mt-1">= ${derivedUnitCost} per {unit}</p>
            )}

            {/* Par + reorder live with purchasing: "when do I order, and how much". */}
            <div className="mt-3 pt-3 border-t border-[#2A2A2A]/60 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Par Level (min stock)</label>
                <div className="flex items-center gap-1.5">
                  <input type="text" value={par} onChange={(e) => setPar(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
                  {canEnterInPacks ? (
                    <select value={parEntryUnit} onChange={(e) => setParEntryUnit(e.target.value as "base" | "pack")}
                      className="px-2 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-xs text-white focus:outline-none">
                      <option value="base">{unit}</option>
                      <option value="pack">{purchaseUnit}</option>
                    </select>
                  ) : (
                    <span className="text-xs text-[#666]">{unit}</span>
                  )}
                </div>
                {parEcho && <p className="text-[10px] text-[#D4A574] mt-1">{parEcho}</p>}
                <p className="text-[10px] text-[#666] mt-1">Order when stock falls below this.</p>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Reorder Qty</label>
                <div className="flex items-center gap-1.5">
                  <input type="text" value={reorder} onChange={(e) => setReorder(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
                  {canEnterInPacks ? (
                    <select value={reorderEntryUnit} onChange={(e) => setReorderEntryUnit(e.target.value as "base" | "pack")}
                      className="px-2 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-xs text-white focus:outline-none">
                      <option value="base">{unit}</option>
                      <option value="pack">{purchaseUnit}</option>
                    </select>
                  ) : (
                    <span className="text-xs text-[#666]">{unit}</span>
                  )}
                </div>
                {reorderEcho && <p className="text-[10px] text-[#D4A574] mt-1">{reorderEcho}</p>}
                <p className="text-[10px] text-[#666] mt-1">How much to order then.</p>
              </div>
            </div>
          </div>
          {/* Suppliers */}
          <div className="rounded-xl border border-[#2A2A2A] bg-[#111]/70 p-3">
            <p className="text-[10px] text-[#D4A574]/70 uppercase tracking-wider mb-1.5">Suppliers</p>
            {ingSuppliers.length > 0 ? (
              <div className="rounded-lg border border-[#2A2A2A] divide-y divide-[#2A2A2A]/30">
                {ingSuppliers.map((s) => (
                  <div key={s.supplierId} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => updateLink(s.supplierId, { preferredInd: !s.preferredInd })}
                        title={s.preferredInd ? "Preferred supplier" : "Set as preferred"}
                        className="shrink-0"
                      >
                        <Star className={`size-3.5 ${s.preferredInd ? "text-[#D4A574] fill-[#D4A574]" : "text-[#666]"}`} />
                      </button>
                      <span className="text-white truncate">{s.supplierName}</span>
                      {s.supplierItemCode && (
                        <span className="text-[#666] shrink-0">SKU: {s.supplierItemCode}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {(s.packCost || s.costPerUnit) && (
                        <span className="text-emerald-400 tabular-nums">
                          ${s.packCost ? Number(s.packCost).toFixed(2) : Number(s.costPerUnit).toFixed(4)}
                        </span>
                      )}
                      <button
                        onClick={() => removeLink(s.supplierId)}
                        className="p-0.5 rounded hover:bg-red-500/10 text-[#666] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#666]">No suppliers assigned</p>
            )}

            {/* Add supplier inline */}
            {!showAddSupplier ? (
              <button
                onClick={() => setShowAddSupplier(true)}
                className="mt-2 flex items-center gap-1 text-xs text-[#D4A574] hover:text-white transition-colors"
              >
                <Plus className="size-3" /> Add Supplier
              </button>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2 items-end">
                <select
                  value={newSupId}
                  onChange={(e) => setNewSupId(e.target.value)}
                  className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-xs text-white focus:outline-none"
                >
                  <option value="">Select supplier...</option>
                  {allSuppliers
                    .filter((s) => !ingSuppliers.some((is) => is.supplierId === s.supplierId))
                    .map((s) => <option key={s.supplierId} value={s.supplierId}>{s.supplierName}</option>)
                  }
                </select>
                <input
                  type="text" value={newSupCost} onChange={(e) => setNewSupCost(e.target.value)}
                  placeholder="Cost"
                  className="w-20 px-2 py-1.5 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-xs text-white placeholder-[#666] focus:outline-none"
                />
                <input
                  type="text" value={newSupSku} onChange={(e) => setNewSupSku(e.target.value)}
                  placeholder="SKU"
                  className="w-20 px-2 py-1.5 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-xs text-white placeholder-[#666] focus:outline-none"
                />
                <button
                  onClick={async () => {
                    if (!newSupId) return;
                    await assign({
                      supplierId: newSupId,
                      costPerUnit: newSupCost || undefined,
                      supplierItemCode: newSupSku || undefined,
                      preferredInd: ingSuppliers.length === 0,
                    });
                    setNewSupId(""); setNewSupCost(""); setNewSupSku("");
                    setShowAddSupplier(false);
                  }}
                  disabled={!newSupId}
                  className="px-2 py-1.5 rounded-lg bg-[#D4A574]/20 text-[#D4A574] text-xs font-medium disabled:opacity-50 hover:bg-[#D4A574]/30 transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddSupplier(false); setNewSupId(""); setNewSupCost(""); setNewSupSku(""); }}
                  className="px-2 py-1.5 text-xs text-[#666] hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Cross-location stock (read-only) */}
          {levels.length > 0 && (
            <div className="rounded-xl border border-[#2A2A2A] bg-[#111]/70 p-3">
              <p className="text-[10px] text-[#D4A574]/70 uppercase tracking-wider mb-1.5">Stock Across Locations</p>
              <div className="rounded-lg border border-[#2A2A2A] divide-y divide-[#2A2A2A]/30">
                {levels.map((l) => {
                  const qty = Number(l.currentQty || 0);
                  const hasStock = l.currentQty != null;
                  const parQty = l.parLevel ? Number(l.parLevel) : null;
                  const isLow = hasStock && parQty != null && qty < parQty;
                  return (
                    <div key={l.storeLocationId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-white">{l.locationName}</span>
                      <span className={`tabular-nums ${isLow ? "text-red-400" : hasStock ? "text-[#E5E5E5]" : "text-[#666]"}`}>
                        {hasStock
                          ? `${qty % 1 === 0 ? qty.toString() : qty.toFixed(1)} ${unit}`
                          : "Not counted yet"}
                        {hasStock && parQty != null && (
                          <span className="text-[#666] ml-1.5">(par: {parQty % 1 === 0 ? parQty.toString() : parQty.toFixed(1)})</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Delete */}
        {deleteConfirm === "blocked" && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs">
            <p className="text-red-400 font-medium mb-1">
              Cannot delete — used by {usageList.length} menu item{usageList.length > 1 ? "s" : ""}:
            </p>
            <ul className="text-[#999] ml-3 list-disc">
              {usageList.map((u) => <li key={u.menuItemId}>{u.menuItemName}</li>)}
            </ul>
            <button onClick={() => setDeleteConfirm("idle")} className="mt-2 text-[#666] underline text-[10px]">Dismiss</button>
          </div>
        )}
        {deleteConfirm === "confirm" && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
            <span className="text-xs text-red-400">Permanently remove this ingredient?</span>
            <button
              onClick={async () => { await onDelete(); }}
              className="px-3 py-1.5 rounded-lg text-xs text-white bg-red-600 hover:bg-red-500 transition-colors"
            >
              Yes, delete
            </button>
            <button onClick={() => setDeleteConfirm("idle")} className="text-xs text-[#666]">Cancel</button>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between mt-5 pt-4 border-t border-[#2A2A2A]">
          <button
            type="button"
            onClick={async () => {
              if (deleteConfirm !== "idle") return;
              setDeleteConfirm("checking");
              const usage = await onCheckUsage();
              if (usage.length > 0) {
                setUsageList(usage);
                setDeleteConfirm("blocked");
              } else {
                setDeleteConfirm("confirm");
              }
            }}
            disabled={deleteConfirm === "checking"}
            className="px-3 py-2 rounded-xl text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors disabled:opacity-50"
          >
            {deleteConfirm === "checking" ? "Checking..." : "Delete"}
          </button>
          <div className="flex gap-2">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-[#999] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={async () => {
              if (!name.trim()) return;
              setSaving(true);
              try {
                await onSave({
                  ingredientName: name,
                  ingredientCategory: cat,
                  baseUnit: unit,
                  // Size only applies to counted things; packaging qty only
                  // when there IS a package — never save stale leftovers.
                  contentQty: MEASURED_UNITS.includes(unit) ? null : contentQty || null,
                  contentUnit: MEASURED_UNITS.includes(unit) ? null : contentUnit || null,
                  purchaseUnit: purchaseUnit || null,
                  packQty: purchaseUnit ? editPackQty || null : null,
                  description: desc || null,
                  unitCost: derivedUnitCost || null,
                  parLevel: toKitchen(par, parEntryUnit),
                  reorderQty: toKitchen(reorder, reorderEntryUnit),
                  itemType: editItemType,
                  fifoApplicable: editFifo,
                  containsDairyInd: allergens.has("containsDairyInd"),
                  containsGlutenInd: allergens.has("containsGlutenInd"),
                  containsNutsInd: allergens.has("containsNutsInd"),
                  containsShellfishInd: allergens.has("containsShellfishInd"),
                  containsEggsInd: allergens.has("containsEggsInd"),
                  isVegetarianInd: allergens.has("isVegetarianInd"),
                } as any);
              } finally {
                setSaving(false);
              }
            }}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save
          </button>
          </div>
        </div>
      </div>

        {/* Right panel — transaction history */}
        <div className="w-80 flex-shrink-0 border-l border-[#2A2A2A] overflow-y-auto"
          style={{ background: "linear-gradient(180deg, rgba(20,23,28,0.99), rgba(14,16,20,0.99))" }}
        >
          <TransactionHistory ingredientId={ingredient.ingredientId} defaultExpanded />
        </div>
      </div>
    </div>
  );
}

// ─── Add Form ────────────────────────────────────────────────────

function AddIngredientForm({
  suppliers,
  onSave,
  onCancel,
}: {
  suppliers: Supplier[];
  onSave: (
    data: Parameters<ReturnType<typeof useIngredients>["create"]>[0],
    supplierLink?: { supplierId: string; costPerUnit: string; packCost?: string },
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemTypeKey>("KITCHEN_INGREDIENT");
  const [fifo, setFifo] = useState<FifoModeKey>(FIFO_DEFAULTS.KITCHEN_INGREDIENT);
  const [category, setCategory] = useState("proteins");
  const [unit, setUnit] = useState("kg");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [par, setPar] = useState("");
  const [reorder, setReorder] = useState("");
  const [allergens, setAllergens] = useState<Set<AllergenKey>>(new Set());
  const [packQty, setPackQty] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [packCost, setPackCost] = useState("");
  const [saving, setSaving] = useState(false);

  const autoUnitCost = packQty && cost && parseFloat(packQty) > 0
    ? (parseFloat(cost) / parseFloat(packQty)).toFixed(4)
    : null;

  const addFormCategories = getCategoriesForType(itemType);

  const toggleAllergen = (key: AllergenKey) => {
    const next = new Set(allergens);
    if (next.has(key)) next.delete(key); else next.add(key);
    setAllergens(next);
  };

  return (
    <div className="p-5 rounded-xl bg-[#161616] border border-[#D4A574]/20 animate-[scaleIn_200ms_ease-out]">
      <h4 className="text-sm font-semibold text-white mb-3">New Ingredient</h4>
      <div className="space-y-3">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Item name" autoFocus
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50" />

        {/* Item type selector */}
        <div>
          <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Item Type</p>
          <div className="flex gap-2">
            {ITEM_TYPE_KEYS.map((tk) => {
              const its = ITEM_TYPES[tk];
              return (
                <button key={tk} type="button"
                  onClick={() => {
                    setItemType(tk);
                    setFifo(FIFO_DEFAULTS[tk]);
                    const validCats = getCategoriesForType(tk);
                    if (!validCats.some((c) => c.key === category)) {
                      setCategory(validCats[0]?.key || "other");
                    }
                  }}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    itemType === tk
                      ? `${its.bgClass} ${its.textClass} ${its.borderClass}`
                      : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
                  }`}
                >
                  {its.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* FIFO mode */}
        <div>
          <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">FIFO Mode</p>
          <select value={fifo} onChange={(e) => setFifo(e.target.value as FifoModeKey)}
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
            {(Object.keys(FIFO_MODES) as FifoModeKey[]).map((fk) => (
              <option key={fk} value={fk}>{FIFO_MODES[fk].label} — {FIFO_MODES[fk].description}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
            {addFormCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input type="text" value={packQty} onChange={(e) => setPackQty(e.target.value)}
            placeholder="Quantity"
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          <select value={unit} onChange={(e) => setUnit(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
            <input type="text" value={cost} onChange={(e) => setCost(e.target.value)}
              placeholder={packQty ? "Cost" : "Cost/unit"}
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
        </div>
        {autoUnitCost && (
          <p className="text-[10px] text-[#D4A574]">
            = ${autoUnitCost} per {unit}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input type="text" value={par} onChange={(e) => setPar(e.target.value)}
            placeholder="Min stock (par)"
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          <input type="text" value={reorder} onChange={(e) => setReorder(e.target.value)}
            placeholder="Reorder qty"
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)" rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none resize-none" />

        {suppliers.length > 0 && (
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Supplier (optional)</p>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              <option value="">No supplier</option>
              {suppliers.filter((s) => s.activeInd).map((s) => (
                <option key={s.supplierId} value={s.supplierId}>{s.supplierName}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Allergens</p>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_DEFS.map((a) => (
              <button key={a.key} type="button" onClick={() => toggleAllergen(a.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  allergens.has(a.key) ? a.color : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
                }`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-[#999] hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!name.trim()) return;
            setSaving(true);
            try {
              await onSave(
                {
                  ingredientName: name, ingredientCategory: category, baseUnit: unit,
                  packQty: packQty || undefined,
                  description: description || undefined, unitCost: autoUnitCost || cost || undefined,
                  parLevel: par || undefined, reorderQty: reorder || undefined,
                  itemType: itemType, fifoApplicable: fifo,
                  containsDairyInd: allergens.has("containsDairyInd"),
                  containsGlutenInd: allergens.has("containsGlutenInd"),
                  containsNutsInd: allergens.has("containsNutsInd"),
                  containsShellfishInd: allergens.has("containsShellfishInd"),
                  containsEggsInd: allergens.has("containsEggsInd"),
                  isVegetarianInd: allergens.has("isVegetarianInd"),
                },
                supplierId ? {
                  supplierId,
                  costPerUnit: autoUnitCost || cost,
                  packCost: cost || undefined,
                } : undefined,
              );
            } finally {
              setSaving(false);
            }
          }}
          disabled={!name.trim() || saving}
          className="flex items-center gap-1.5 px-5 py-1.5 rounded-lg bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-all"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}
