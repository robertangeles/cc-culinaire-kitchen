import { Search, Plus } from "lucide-react";
import { ALLERGEN_DEFS, type AllergenKey } from "./allergenDefs.js";

interface IngredientFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  typeFilter: string;
  onTypeFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  allergenFilter: AllergenKey | null;
  onAllergenFilterChange: (v: AllergenKey | null) => void;
  onAdd: () => void;
}

export function IngredientFilters({
  search, onSearchChange,
  typeFilter, onTypeFilterChange,
  statusFilter, onStatusFilterChange,
  allergenFilter, onAllergenFilterChange,
  onAdd,
}: IngredientFiltersProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-dark-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search items..."
            className="w-full pl-10 pr-4 py-1.5 rounded-lg bg-dark-50 border border-dark-200 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-gold/50 transition-all"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-dark-50 border border-dark-200 text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="all">All Types</option>
          <option value="KITCHEN_INGREDIENT">Kitchen</option>
          <option value="FOH_CONSUMABLE">FOH</option>
          <option value="OPERATIONAL_SUPPLY">Operational</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-dark-50 border border-dark-200 text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="low">Low</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={allergenFilter || ""}
          onChange={(e) => onAllergenFilterChange((e.target.value || null) as AllergenKey | null)}
          className="px-3 py-1.5 rounded-lg bg-dark-50 border border-dark-200 text-sm text-white appearance-none cursor-pointer focus:outline-none"
        >
          <option value="">Allergens</option>
          {ALLERGEN_DEFS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-gold to-gold-hover text-dark text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
        >
          <Plus className="size-4" />
          Add
        </button>
      </div>

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
    </>
  );
}
