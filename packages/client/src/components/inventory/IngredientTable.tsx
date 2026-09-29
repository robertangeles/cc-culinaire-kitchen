import { Utensils } from "lucide-react";
import type { Ingredient, LocationIngredient } from "../../hooks/useInventory.js";

type CategoryCounts = Record<string, { total: number; low: number; critical: number }>;

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
  none: { text: "—", className: "text-dark-500" },
};

interface IngredientTableProps {
  availableCategories: Array<{ key: string; label: string }>;
  categoryCounts: CategoryCounts;
  selectedCategory: string;
  onCategoryChange: (cat: string) => void;
  filtered: Ingredient[];
  locMap: Map<string, LocationIngredient>;
  search: string;
  onEditIngredient: (ing: Ingredient) => void;
}

export function IngredientTable({
  availableCategories,
  categoryCounts,
  selectedCategory,
  onCategoryChange,
  filtered,
  locMap,
  search,
  onEditIngredient,
}: IngredientTableProps) {
  return (
    <div className="flex rounded-xl border border-dark-100 overflow-hidden max-h-[calc(100vh-280px)]">
      {/* Category sidebar */}
      <div className="flex-shrink-0 w-52 bg-dark border-r border-dark-100 overflow-y-auto">
        {availableCategories.map((cat) => {
          const counts = categoryCounts[cat.key];
          const total = counts?.total || 0;
          const hasCritical = (counts?.critical || 0) > 0;
          const hasLow = (counts?.low || 0) > 0;
          const isActive = selectedCategory === cat.key;

          return (
            <button
              key={cat.key}
              onClick={() => onCategoryChange(cat.key)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? "bg-dark-100 text-white border-l-2 border-gold"
                  : "text-[#888] hover:text-white hover:bg-dark-50 border-l-2 border-transparent"
              }`}
            >
              <span className="truncate">{cat.label}</span>
              <span className="flex items-center gap-1.5 shrink-0 ml-2">
                {hasCritical && <span className="size-1.5 rounded-full bg-red-400" />}
                {!hasCritical && hasLow && <span className="size-1.5 rounded-full bg-amber-400" />}
                <span className={`text-xs tabular-nums ${isActive ? "text-dark-600" : "text-[#555]"}`}>
                  {total}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Item table */}
      <div className="flex-1 min-w-0 bg-[#111] overflow-y-auto">
        <div className="sticky top-0 z-10 grid grid-cols-12 gap-1 px-4 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider border-b border-dark-100 bg-[#111]">
          <div className="col-span-4">Name</div>
          <div className="col-span-1">UOM</div>
          <div className="col-span-2 text-right">Cost</div>
          <div className="col-span-2 text-right">Stock</div>
          <div className="col-span-1 text-right">Par</div>
          <div className="col-span-2 text-right">Status</div>
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Utensils className="size-8 mx-auto text-gold mb-3" />
            <p className="text-sm text-white font-medium mb-1">
              {search ? "No matching items" : "No items in this category"}
            </p>
            <p className="text-xs text-dark-600">
              {search ? "Try a different search." : "Add your first item."}
            </p>
          </div>
        )}

        {filtered.map((ing) => {
          const loc = locMap.get(ing.ingredientId);
          const status = getStockStatus(loc);
          const sl = STATUS_LABEL[status];
          const cost = loc?.locationUnitCost || ing.unitCost;
          const qty = loc?.currentQty ? Number(loc.currentQty) : null;
          const par = loc?.parLevel ? Number(loc.parLevel) : ing.parLevel ? Number(ing.parLevel) : null;
          const isLowStock = qty !== null && par !== null && par > 0 && qty / par <= 0.75;
          const fmtStock = (n: number) => (n % 1 === 0 ? n.toString() : n.toFixed(1));

          return (
            <button
              key={ing.ingredientId}
              onClick={() => onEditIngredient(ing)}
              className="w-full grid grid-cols-12 gap-1 px-4 py-1.5 text-sm hover:bg-[#1A1A1A] cursor-pointer transition-colors text-left items-center"
            >
              <div className="col-span-4 text-white truncate">{ing.ingredientName}</div>
              <div className="col-span-1 text-dark-500">{ing.baseUnit}</div>
              <div className="col-span-2 text-right text-dark-600 font-mono tabular-nums">
                {cost
                  ? `$${(ing.packQty ? (Number(cost) * Number(ing.packQty)).toFixed(2) : Number(cost).toFixed(2))}`
                  : "—"}
              </div>
              <div className={`col-span-2 text-right font-mono tabular-nums ${isLowStock ? "text-amber-400" : "text-white"}`}>
                {qty !== null ? fmtStock(qty) : "—"}
              </div>
              <div className="col-span-1 text-right text-dark-500 font-mono tabular-nums">
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
  );
}
