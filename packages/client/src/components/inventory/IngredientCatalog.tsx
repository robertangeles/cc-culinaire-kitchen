/**
 * @module components/inventory/IngredientCatalog
 *
 * Org-wide ingredient catalog management. Allows adding, editing,
 * and searching ingredients with category filtering.
 */

import { useState } from "react";
import { useIngredients, type Ingredient } from "../../hooks/useInventory.js";
import {
  Plus, Search, Edit3, Loader2, ChevronDown,
  Utensils, X, Check,
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

export function IngredientCatalog() {
  const { ingredients, isLoading, create, update } = useIngredients();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter ingredients
  const filtered = ingredients.filter((i) => {
    if (filterCat && i.ingredientCategory !== filterCat) return false;
    if (search && !i.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by category
  const grouped = new Map<string, Ingredient[]>();
  for (const ing of filtered) {
    if (!grouped.has(ing.ingredientCategory)) grouped.set(ing.ingredientCategory, []);
    grouped.get(ing.ingredientCategory)!.push(ing);
  }

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
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

      {error && (
        <p className="text-sm text-red-400 px-1">{error}</p>
      )}

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
            {search ? "No matching ingredients" : "No ingredients yet"}
          </h3>
          <p className="text-sm text-[#999] max-w-sm mx-auto">
            {search
              ? "Try a different search term."
              : "Add your first ingredient to start building your catalog."
            }
          </p>
        </div>
      )}

      {/* Grouped ingredient list */}
      {!isLoading && Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <h4 className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-2 px-1">
            {CATEGORIES.find((c) => c.key === cat)?.label || cat}
            <span className="text-[#666] ml-2">{items.length}</span>
          </h4>
          <div className="space-y-1">
            {items.map((ing) => (
              <IngredientRow
                key={ing.ingredientId}
                ingredient={ing}
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

function AddIngredientForm({
  onSave,
  onCancel,
}: {
  onSave: (data: { ingredientName: string; ingredientCategory: string; baseUnit: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("proteins");
  const [unit, setUnit] = useState("kg");
  const [saving, setSaving] = useState(false);

  return (
    <div className="p-4 rounded-xl bg-[#161616] border border-[#D4A574]/20 animate-[scaleIn_200ms_ease-out]">
      <h4 className="text-sm font-semibold text-white mb-3">New Ingredient</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ingredient name"
          autoFocus
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-[#999] hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!name.trim()) return;
            setSaving(true);
            await onSave({ ingredientName: name, ingredientCategory: category, baseUnit: unit });
            setSaving(false);
          }}
          disabled={!name.trim() || saving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#D4A574] text-[#0A0A0A] text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-all"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </button>
      </div>
    </div>
  );
}

function IngredientRow({
  ingredient, isEditing, onEdit, onSave, onCancel,
}: {
  ingredient: Ingredient;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (data: Partial<Ingredient>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(ingredient.ingredientName);

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-xl bg-[#161616] border border-[#D4A574]/20">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="flex-1 px-2 py-1 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50"
        />
        <button onClick={() => onSave({ ingredientName: name })} className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-400">
          <Check className="size-4" />
        </button>
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-2 rounded-xl hover:bg-[#161616] transition-colors group">
      <div>
        <p className="text-sm text-white">{ingredient.ingredientName}</p>
        <p className="text-xs text-[#666]">{ingredient.baseUnit}</p>
      </div>
      <button
        onClick={onEdit}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#2A2A2A] text-[#999] hover:text-white transition-all"
      >
        <Edit3 className="size-3.5" />
      </button>
    </div>
  );
}
