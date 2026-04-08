/**
 * @module components/inventory/IngredientCatalog
 *
 * Org-wide ingredient catalog with rich cards showing description, cost,
 * allergen tags, stock badges, and supplier info. Supports allergen
 * filtering and expanded add/edit forms.
 */

import { useState } from "react";
import {
  useIngredients,
  useSuppliers,
  useLocationIngredients,
  type Ingredient,
  type LocationIngredient,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import {
  Plus, Search, Edit3, Loader2, Utensils, X, Check,
  DollarSign, AlertTriangle, Package, Truck,
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

const ALLERGEN_FILTERS = [
  { key: "containsDairyInd", label: "Dairy", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { key: "containsGlutenInd", label: "Gluten", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { key: "containsNutsInd", label: "Nuts", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { key: "containsShellfishInd", label: "Shellfish", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { key: "containsEggsInd", label: "Eggs", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { key: "isVegetarianInd", label: "Vegetarian", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
] as const;

type AllergenKey = typeof ALLERGEN_FILTERS[number]["key"];

export function IngredientCatalog() {
  const { ingredients, isLoading, create, update } = useIngredients();
  const { selectedLocationId } = useLocation();
  const { items: locItems } = useLocationIngredients(selectedLocationId);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [allergenFilters, setAllergenFilters] = useState<Set<AllergenKey>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build a lookup from ingredientId → location data (stock, par, supplier)
  const locMap = new Map<string, LocationIngredient>();
  for (const item of locItems) {
    locMap.set(item.ingredientId, item);
  }

  // Filter ingredients
  const filtered = ingredients.filter((i) => {
    if (filterCat && i.ingredientCategory !== filterCat) return false;
    if (search && !i.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
    // Allergen filters: show only ingredients that HAVE the selected allergens
    for (const key of allergenFilters) {
      if (!i[key]) return false;
    }
    return true;
  });

  // Group by category
  const grouped = new Map<string, Ingredient[]>();
  for (const ing of filtered) {
    if (!grouped.has(ing.ingredientCategory)) grouped.set(ing.ingredientCategory, []);
    grouped.get(ing.ingredientCategory)!.push(ing);
  }

  const toggleAllergen = (key: AllergenKey) => {
    const next = new Set(allergenFilters);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setAllergenFilters(next);
  };

  return (
    <div className="space-y-5 animate-[fadeInUp_200ms_ease-out]">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 focus:shadow-[0_0_0_2px_rgba(212,165,116,0.15)] transition-all"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={filterCat || ""}
            onChange={(e) => setFilterCat(e.target.value || null)}
            className="px-3 py-2.5 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-[#D4A574]/50"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => { setShowAdd(true); setError(null); }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
          >
            <Plus className="size-4" />
            Add
          </button>
        </div>
      </div>

      {/* Allergen filter chips */}
      <div className="flex flex-wrap gap-2">
        {ALLERGEN_FILTERS.map((af) => (
          <button
            key={af.key}
            onClick={() => toggleAllergen(af.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              allergenFilters.has(af.key)
                ? af.color
                : "bg-[#161616] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
            }`}
          >
            {af.label}
          </button>
        ))}
        {allergenFilters.size > 0 && (
          <button
            onClick={() => setAllergenFilters(new Set())}
            className="px-3 py-1 rounded-full text-xs text-[#999] hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400 px-1">{error}</p>}

      {/* Add ingredient form */}
      {showAdd && (
        <AddIngredientForm
          onSave={async (data) => {
            try {
              setError(null);
              await create(data);
              setShowAdd(false);
            } catch (err: any) {
              setError(err.message);
            }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E] flex items-center justify-center shadow-[0_0_12px_rgba(212,165,116,0.1)]">
            <Utensils className="size-8 text-[#D4A574]" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {search || allergenFilters.size > 0 ? "No matching ingredients" : "No ingredients yet"}
          </h3>
          <p className="text-sm text-[#999] max-w-sm mx-auto">
            {search ? "Try a different search term." : "Add your first ingredient to start building your catalog."}
          </p>
        </div>
      )}

      {/* Grouped ingredient cards */}
      {!isLoading && Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <h4 className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-3 px-1">
            {CATEGORIES.find((c) => c.key === cat)?.label || cat}
            <span className="text-[#666] ml-2">{items.length}</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((ing) => (
              <IngredientCard
                key={ing.ingredientId}
                ingredient={ing}
                locData={locMap.get(ing.ingredientId)}
                isEditing={editId === ing.ingredientId}
                onEdit={() => setEditId(ing.ingredientId)}
                onSave={async (data) => {
                  try {
                    setError(null);
                    await update(ing.ingredientId, data);
                    setEditId(null);
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
                onCancel={() => setEditId(null)}
              />
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-[#666] text-center">
        {filtered.length} ingredient{filtered.length !== 1 ? "s" : ""}
        {filterCat ? ` in ${CATEGORIES.find((c) => c.key === filterCat)?.label}` : ""}
      </p>
    </div>
  );
}

// ─── Ingredient Card ─────────────────────────────────────────────

function IngredientCard({
  ingredient, locData, isEditing, onEdit, onSave, onCancel,
}: {
  ingredient: Ingredient;
  locData?: LocationIngredient;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (data: Partial<Ingredient>) => Promise<void>;
  onCancel: () => void;
}) {
  const [editName, setEditName] = useState(ingredient.ingredientName);
  const [editCat, setEditCat] = useState(ingredient.ingredientCategory);
  const [editUnit, setEditUnit] = useState(ingredient.baseUnit);
  const [editDesc, setEditDesc] = useState(ingredient.description || "");
  const [editCost, setEditCost] = useState(ingredient.unitCost || "");
  const [editPar, setEditPar] = useState(ingredient.parLevel || "");
  const [editReorder, setEditReorder] = useState(ingredient.reorderQty || "");
  const [saving, setSaving] = useState(false);

  // Stock status
  const stockStatus = getStockStatus(locData);
  const effectiveCost = locData?.locationUnitCost || ingredient.unitCost;

  // Allergen tags to show
  const allergens = getAllergenTags(ingredient);

  if (isEditing) {
    return (
      <div className="p-4 rounded-xl bg-[#161616] border border-[#D4A574]/20 animate-[scaleIn_150ms_ease-out] space-y-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          autoFocus
          placeholder="Ingredient name"
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select
            value={editCat}
            onChange={(e) => setEditCat(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
          >
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select
            value={editUnit}
            onChange={(e) => setEditUnit(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
          >
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
            <input
              type="text"
              value={editCost}
              onChange={(e) => setEditCost(e.target.value)}
              placeholder="Cost/unit"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
            />
          </div>
          <input
            type="text"
            value={editPar}
            onChange={(e) => setEditPar(e.target.value)}
            placeholder="Min stock (par)"
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
          />
          <input
            type="text"
            value={editReorder}
            onChange={(e) => setEditReorder(e.target.value)}
            placeholder="Reorder qty"
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
          />
        </div>
        <textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 resize-none"
        />
        {/* Allergen toggles */}
        <div className="flex flex-wrap gap-1.5">
          {ALLERGEN_FILTERS.map((af) => {
            const val = ingredient[af.key];
            return (
              <button
                key={af.key}
                type="button"
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                  val ? af.color : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A]"
                }`}
                // Allergen editing — toggle on click during edit
              >
                {af.label}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-[#999] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={async () => {
              if (!editName.trim()) return;
              setSaving(true);
              await onSave({
                ingredientName: editName,
                ingredientCategory: editCat,
                baseUnit: editUnit,
                description: editDesc || null,
                unitCost: editCost || null,
                parLevel: editPar || null,
                reorderQty: editReorder || null,
              } as any);
              setSaving(false);
            }}
            disabled={!editName.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#D4A574] text-[#0A0A0A] text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl bg-[#161616] border border-[#2A2A2A] hover:-translate-y-0.5 hover:shadow-lg transition-all group">
      {/* Row 1: Name + stock badge */}
      <div className="flex items-start justify-between mb-1">
        <h4 className="text-sm font-medium text-white">{ingredient.ingredientName}</h4>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <StockBadge status={stockStatus} />
          <button
            onClick={onEdit}
            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#2A2A2A] text-[#999] hover:text-white transition-all"
          >
            <Edit3 className="size-3" />
          </button>
        </div>
      </div>

      {/* Description */}
      {ingredient.description && (
        <p className="text-xs text-[#999] mb-2 line-clamp-2">{ingredient.description}</p>
      )}

      {/* Row 2: Category, unit, cost */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#666] mb-2">
        <span>{CATEGORIES.find((c) => c.key === ingredient.ingredientCategory)?.label} · {ingredient.baseUnit}</span>
        {effectiveCost && (
          <span className="flex items-center gap-0.5 text-emerald-400">
            <DollarSign className="size-3" />
            {Number(effectiveCost).toFixed(2)}/{ingredient.baseUnit}
          </span>
        )}
      </div>

      {/* Row 3: Stock level, par, reorder, supplier */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#666] mb-2">
        {locData?.currentQty ? (
          <span className="flex items-center gap-1 text-white font-medium">
            <Package className="size-3 text-[#D4A574]" />
            {Number(locData.currentQty).toFixed(1)} {ingredient.baseUnit}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Package className="size-3" />
            No stock data
          </span>
        )}
        {(locData?.parLevel || ingredient.parLevel) && (
          <span>Par: {Number(locData?.parLevel || ingredient.parLevel).toFixed(0)}</span>
        )}
        {(locData?.reorderQty || ingredient.reorderQty) && (
          <span>Reorder: {Number(locData?.reorderQty || ingredient.reorderQty).toFixed(0)}</span>
        )}
        {locData?.supplierName && (
          <span className="flex items-center gap-1">
            <Truck className="size-3" />
            {locData.supplierName}
          </span>
        )}
      </div>

      {/* Allergen tags */}
      {allergens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {allergens.map((a) => (
            <span key={a.key} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${a.color}`}>
              {a.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stock Badge ─────────────────────────────────────────────────

type StockStatusType = "healthy" | "low" | "critical" | "none";

function StockBadge({ status }: { status: StockStatusType }) {
  const config = {
    healthy: { label: "In Stock", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    low: { label: "Low", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    critical: { label: "Critical", className: "bg-red-500/10 text-red-400 border-red-500/20" },
    none: { label: "No Data", className: "bg-[#1E1E1E] text-[#666] border-[#2A2A2A]" },
  }[status];

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
}

function getStockStatus(locData?: LocationIngredient): StockStatusType {
  if (!locData?.currentQty || !locData?.parLevel) return "none";
  const ratio = Number(locData.currentQty) / Number(locData.parLevel);
  if (ratio <= 0.25) return "critical";
  if (ratio <= 0.75) return "low";
  return "healthy";
}

function getAllergenTags(ing: Ingredient) {
  const tags: { key: string; label: string; color: string }[] = [];
  if (ing.containsDairyInd) tags.push({ key: "dairy", label: "Dairy", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" });
  if (ing.containsGlutenInd) tags.push({ key: "gluten", label: "Gluten", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" });
  if (ing.containsNutsInd) tags.push({ key: "nuts", label: "Nuts", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" });
  if (ing.containsShellfishInd) tags.push({ key: "shellfish", label: "Shellfish", color: "bg-red-500/20 text-red-400 border-red-500/30" });
  if (ing.containsEggsInd) tags.push({ key: "eggs", label: "Eggs", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" });
  if (ing.isVegetarianInd) tags.push({ key: "veg", label: "Vegetarian", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" });
  return tags;
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
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setAllergens(next);
  };

  return (
    <div className="p-5 rounded-xl bg-[#161616] border border-[#D4A574]/20 animate-[scaleIn_200ms_ease-out]">
      <h4 className="text-sm font-semibold text-white mb-4">New Ingredient</h4>

      {/* Row 1: Name */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ingredient name"
        autoFocus
        className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 mb-3"
      />

      {/* Row 2: Category, Unit, Cost, Par, Reorder */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        >
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <div className="relative">
          <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
          <input
            type="text"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost per unit"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
          />
        </div>
        <input
          type="text"
          value={par}
          onChange={(e) => setPar(e.target.value)}
          placeholder="Min stock (par level)"
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
        />
        <input
          type="text"
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
          placeholder="Reorder qty"
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
        />
      </div>

      {/* Row 3: Description */}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (e.g., Fresh Atlantic salmon, skin-on, pin-boned)"
        rows={2}
        className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 resize-none mb-3"
      />

      {/* Allergen toggles */}
      <div className="mb-4">
        <p className="text-[10px] text-[#666] uppercase tracking-wider mb-2">Allergens</p>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGEN_FILTERS.map((af) => (
            <button
              key={af.key}
              type="button"
              onClick={() => toggleAllergen(af.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                allergens.has(af.key)
                  ? af.color
                  : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
              }`}
            >
              {af.label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-[#999] hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!name.trim()) return;
            setSaving(true);
            await onSave({
              ingredientName: name,
              ingredientCategory: category,
              baseUnit: unit,
              description: description || undefined,
              unitCost: cost || undefined,
              parLevel: par || undefined,
              reorderQty: reorder || undefined,
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
          Add Ingredient
        </button>
      </div>
    </div>
  );
}
