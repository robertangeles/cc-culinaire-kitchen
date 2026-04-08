/**
 * @module components/inventory/IngredientCatalog
 *
 * Compact table-based ingredient catalog. Click a row to expand
 * inline detail with cross-location stock. Edit opens a modal
 * dialog with all fields + read-only cross-location stock table.
 */

import { useState } from "react";
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

const CATEGORIES = [
  { key: "proteins", label: "Proteins" },
  { key: "produce", label: "Produce" },
  { key: "dairy", label: "Dairy" },
  { key: "dry_goods", label: "Dry Goods" },
  { key: "beverages", label: "Beverages" },
  { key: "spirits", label: "Spirits" },
  { key: "frozen", label: "Frozen" },
  { key: "bakery", label: "Bakery" },
  { key: "condiments", label: "Condiments" },
  { key: "other", label: "Other" },
];

const UNITS = ["kg", "g", "L", "mL", "each", "case", "dozen", "bunch", "bottle", "can", "bag", "box"];

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
  const { ingredients, isLoading, create, update } = useIngredients();
  const { selectedLocationId } = useLocation();
  const { items: locItems } = useLocationIngredients(selectedLocationId);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [allergenFilter, setAllergenFilter] = useState<AllergenKey | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editIngredient, setEditIngredient] = useState<Ingredient | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locMap = new Map<string, LocationIngredient>();
  for (const item of locItems) locMap.set(item.ingredientId, item);

  const filtered = ingredients.filter((i) => {
    if (filterCat && i.ingredientCategory !== filterCat) return false;
    if (search && !i.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
    if (allergenFilter && !i[allergenFilter]) return false;
    return true;
  });

  const grouped = new Map<string, Ingredient[]>();
  for (const ing of filtered) {
    if (!grouped.has(ing.ingredientCategory)) grouped.set(ing.ingredientCategory, []);
    grouped.get(ing.ingredientCategory)!.push(ing);
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 transition-all"
          />
        </div>
        <select
          value={filterCat || ""}
          onChange={(e) => setFilterCat(e.target.value || null)}
          className="px-3 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select
          value={allergenFilter || ""}
          onChange={(e) => setAllergenFilter((e.target.value || null) as AllergenKey | null)}
          className="px-3 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">Allergens</option>
          {ALLERGEN_DEFS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button
          onClick={() => { setShowAdd(true); setError(null); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Add
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAdd && (
        <AddIngredientForm
          onSave={async (data) => {
            try { setError(null); await create(data); setShowAdd(false); }
            catch (err: any) { setError(err.message); }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <Utensils className="size-8 mx-auto text-[#D4A574] mb-3" />
          <p className="text-sm text-white font-medium mb-1">
            {search ? "No matching ingredients" : "No ingredients yet"}
          </p>
          <p className="text-xs text-[#999]">
            {search ? "Try a different search." : "Add your first ingredient."}
          </p>
        </div>
      )}

      {/* Grouped tables */}
      {!isLoading && Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat} className="rounded-xl border border-[#2A2A2A] overflow-hidden">
          {/* Category header */}
          <div className="px-4 py-2 bg-[#161616] border-b border-[#2A2A2A]">
            <span className="text-[10px] font-semibold text-[#999] uppercase tracking-wider">
              {CATEGORIES.find((c) => c.key === cat)?.label || cat}
            </span>
            <span className="text-[10px] text-[#666] ml-2">{items.length}</span>
          </div>

          {/* Table header */}
          <div className="hidden sm:grid grid-cols-12 gap-1 px-4 py-1.5 text-[10px] text-[#666] uppercase tracking-wider border-b border-[#2A2A2A]/50">
            <div className="col-span-4">Name</div>
            <div className="col-span-1">UOM</div>
            <div className="col-span-2 text-right">Cost</div>
            <div className="col-span-2 text-right">Stock</div>
            <div className="col-span-1 text-right">Par</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          {/* Rows */}
          {items.map((ing) => {
            const loc = locMap.get(ing.ingredientId);
            const status = getStockStatus(loc);
            const sl = STATUS_LABEL[status];
            const isExpanded = expandedId === ing.ingredientId;
            const cost = loc?.locationUnitCost || ing.unitCost;

            return (
              <div key={ing.ingredientId}>
                {/* Compact row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : ing.ingredientId)}
                  className="w-full grid grid-cols-12 gap-1 px-4 py-2 text-sm hover:bg-[#1E1E1E]/50 transition-colors text-left items-center"
                >
                  <div className="col-span-4 sm:col-span-4 flex items-center gap-1.5 truncate">
                    {isExpanded
                      ? <ChevronDown className="size-3 text-[#666] shrink-0" />
                      : <ChevronRight className="size-3 text-[#666] shrink-0" />
                    }
                    <span className="text-white truncate">{ing.ingredientName}</span>
                  </div>
                  <div className="col-span-1 text-[#666] hidden sm:block">{ing.baseUnit}</div>
                  <div className="col-span-2 text-right text-[#999] tabular-nums hidden sm:block">
                    {cost ? `$${Number(cost).toFixed(2)}` : "—"}
                  </div>
                  <div className="col-span-2 text-right text-white font-medium tabular-nums">
                    {loc?.currentQty ? Number(loc.currentQty).toFixed(1) : "—"}
                  </div>
                  <div className="col-span-1 text-right text-[#666] tabular-nums hidden sm:block">
                    {loc?.parLevel ? Number(loc.parLevel).toFixed(0) : ing.parLevel ? Number(ing.parLevel).toFixed(0) : "—"}
                  </div>
                  <div className={`col-span-2 text-right text-xs font-medium ${sl.className}`}>
                    {sl.text}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <ExpandedDetail
                    ingredient={ing}
                    locData={loc}
                    onEdit={() => setEditIngredient(ing)}
                    onClose={() => setExpandedId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      <p className="text-xs text-[#666] text-center">{filtered.length} ingredients</p>

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
          onClose={() => setEditIngredient(null)}
        />
      )}
    </div>
  );
}

// ─── Expanded Detail ─────────────────────────────────────────────

function ExpandedDetail({
  ingredient, locData, onEdit, onClose,
}: {
  ingredient: Ingredient;
  locData?: LocationIngredient;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { levels, isLoading } = useIngredientStock(ingredient.ingredientId);
  const allergens = ALLERGEN_DEFS.filter((a) => ingredient[a.key]);

  return (
    <div className="px-4 py-3 bg-[#0A0A0A]/50 border-t border-[#2A2A2A]/30 animate-[fadeIn_150ms_ease-out]">
      {/* Description + allergens */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          {ingredient.description && (
            <p className="text-xs text-[#999] mb-1.5">{ingredient.description}</p>
          )}
          {allergens.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allergens.map((a) => (
                <span key={a.key} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${a.color}`}>
                  {a.label}
                </span>
              ))}
            </div>
          )}
          {locData?.supplierName && (
            <div className="flex items-center gap-1 text-xs text-[#666] mt-1.5">
              <Truck className="size-3" />
              {locData.supplierName}
            </div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="px-3 py-1 rounded-lg bg-[#D4A574]/10 text-[#D4A574] text-xs font-medium hover:bg-[#D4A574]/20 transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Cross-location stock table */}
      <div className="rounded-lg border border-[#2A2A2A] overflow-hidden">
        <div className="px-3 py-1.5 bg-[#161616] text-[10px] text-[#999] uppercase tracking-wider font-semibold">
          Stock Across Locations
        </div>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 text-[#D4A574] animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-[#2A2A2A]/30">
            <div className="hidden sm:grid grid-cols-5 gap-1 px-3 py-1 text-[10px] text-[#666] uppercase tracking-wider">
              <div className="col-span-2">Location</div>
              <div className="text-right">Stock</div>
              <div className="text-right">Par</div>
              <div className="text-right">Status</div>
            </div>
            {levels.map((l) => {
              const qty = Number(l.currentQty || 0);
              const par = Number(l.parLevel || 0);
              let status: "healthy" | "low" | "critical" | "none" = "none";
              if (l.currentQty && l.parLevel) {
                const ratio = qty / par;
                status = ratio <= 0.25 ? "critical" : ratio <= 0.75 ? "low" : "healthy";
              }
              const sl = STATUS_LABEL[status];
              return (
                <div key={l.storeLocationId} className="grid grid-cols-5 gap-1 px-3 py-1.5 text-xs">
                  <div className="col-span-2 text-white truncate">{l.locationName}</div>
                  <div className="text-right text-white tabular-nums">
                    {l.currentQty ? `${qty.toFixed(1)}` : "—"}
                  </div>
                  <div className="text-right text-[#666] tabular-nums">
                    {par > 0 ? par.toFixed(0) : "—"}
                  </div>
                  <div className={`text-right font-medium ${sl.className}`}>{sl.text}</div>
                </div>
              );
            })}
            {levels.length === 0 && (
              <p className="text-xs text-[#666] text-center py-3">No stock data</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────

function EditIngredientModal({
  ingredient, onSave, onClose,
}: {
  ingredient: Ingredient;
  onSave: (data: Partial<Ingredient>) => Promise<void>;
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
  const [cat, setCat] = useState(ingredient.ingredientCategory);
  const [unit, setUnit] = useState(ingredient.baseUnit);
  const [desc, setDesc] = useState(ingredient.description || "");
  const [cost, setCost] = useState(ingredient.unitCost || "");
  const [par, setPar] = useState(ingredient.parLevel || "");
  const [reorder, setReorder] = useState(ingredient.reorderQty || "");
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
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 rounded-2xl bg-[#161616] border border-[#2A2A2A] shadow-2xl animate-[scaleIn_200ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Edit Ingredient</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#2A2A2A] text-[#999] hover:text-white transition-all">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ingredient name" autoFocus
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
          />
          <div className="grid grid-cols-3 gap-2">
            <select value={cat} onChange={(e) => setCat(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
              <input type="text" value={cost} onChange={(e) => setCost(e.target.value)}
                placeholder="Cost/unit"
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={par} onChange={(e) => setPar(e.target.value)}
              placeholder="Min stock (par level)"
              className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
            <input type="text" value={reorder} onChange={(e) => setReorder(e.target.value)}
              placeholder="Reorder qty"
              className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="Description" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none resize-none" />

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

          {/* Suppliers */}
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Suppliers</p>
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
                      {s.costPerUnit && (
                        <span className="text-emerald-400 tabular-nums">${Number(s.costPerUnit).toFixed(2)}</span>
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
            <div>
              <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1.5">Stock Across Locations</p>
              <div className="rounded-lg border border-[#2A2A2A] divide-y divide-[#2A2A2A]/30">
                {levels.map((l) => {
                  const qty = Number(l.currentQty || 0);
                  return (
                    <div key={l.storeLocationId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-white">{l.locationName}</span>
                      <span className="text-[#999] tabular-nums">
                        {l.currentQty ? `${qty.toFixed(1)} ${unit}` : "No data"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[#2A2A2A]">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-[#999] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={async () => {
              if (!name.trim()) return;
              setSaving(true);
              await onSave({
                ingredientName: name,
                ingredientCategory: cat,
                baseUnit: unit,
                description: desc || null,
                unitCost: cost || null,
                parLevel: par || null,
                reorderQty: reorder || null,
                containsDairyInd: allergens.has("containsDairyInd"),
                containsGlutenInd: allergens.has("containsGlutenInd"),
                containsNutsInd: allergens.has("containsNutsInd"),
                containsShellfishInd: allergens.has("containsShellfishInd"),
                containsEggsInd: allergens.has("containsEggsInd"),
                isVegetarianInd: allergens.has("isVegetarianInd"),
              } as any);
              setSaving(false);
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
  );
}

// ─── Add Form ────────────────────────────────────────────────────

function AddIngredientForm({
  onSave,
  onCancel,
}: {
  onSave: (data: Parameters<ReturnType<typeof useIngredients>["create"]>[0]) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("proteins");
  const [unit, setUnit] = useState("kg");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [par, setPar] = useState("");
  const [reorder, setReorder] = useState("");
  const [allergens, setAllergens] = useState<Set<AllergenKey>>(new Set());
  const [saving, setSaving] = useState(false);

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
          placeholder="Ingredient name" autoFocus
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
            <input type="text" value={cost} onChange={(e) => setCost(e.target.value)}
              placeholder="Cost/unit"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
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
            await onSave({
              ingredientName: name, ingredientCategory: category, baseUnit: unit,
              description: description || undefined, unitCost: cost || undefined,
              parLevel: par || undefined, reorderQty: reorder || undefined,
              containsDairyInd: allergens.has("containsDairyInd"),
              containsGlutenInd: allergens.has("containsGlutenInd"),
              containsNutsInd: allergens.has("containsNutsInd"),
              containsShellfishInd: allergens.has("containsShellfishInd"),
              containsEggsInd: allergens.has("containsEggsInd"),
              isVegetarianInd: allergens.has("isVegetarianInd"),
            });
            setSaving(false);
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
