/**
 * Sortable table of menu items with classification badges.
 */

import { useState } from "react";
import { Trash2, ChevronUp, ChevronDown, Star, TrendingDown, HelpCircle, XCircle } from "lucide-react";
import type { MenuItem } from "../../hooks/useMenuItems.js";

const CLASS_BADGES: Record<string, { label: string; color: string; icon: typeof Star }> = {
  star: { label: "Star", color: "bg-amber-100 text-amber-700", icon: Star },
  plowhorse: { label: "Plowhorse", color: "bg-blue-100 text-blue-700", icon: TrendingDown },
  puzzle: { label: "Puzzle", color: "bg-purple-100 text-purple-700", icon: HelpCircle },
  dog: { label: "Dog", color: "bg-red-100 text-red-700", icon: XCircle },
  unclassified: { label: "—", color: "bg-stone-100 text-stone-500", icon: HelpCircle },
};

type SortKey = "name" | "category" | "sellingPrice" | "foodCostPct" | "contributionMargin" | "unitsSold" | "menuMixPct" | "classification";

interface MenuItemsTableProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  onDelete: (id: string) => void;
  onUpdateSales: (id: string, unitsSold: number) => void;
}

export function MenuItemsTable({ items, onSelect, onDelete, onUpdateSales }: MenuItemsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...items].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />;
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50">
              {([
                ["name", "Item"],
                ["category", "Category"],
                ["sellingPrice", "Price"],
                ["foodCostPct", "Food Cost %"],
                ["contributionMargin", "CM"],
                ["unitsSold", "Units Sold"],
                ["menuMixPct", "Mix %"],
                ["classification", "Class"],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase cursor-pointer hover:text-stone-700 select-none"
                >
                  <span className="flex items-center gap-1">{label} <SortIcon col={key} /></span>
                </th>
              ))}
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((item) => {
              const badge = CLASS_BADGES[item.classification] ?? CLASS_BADGES.unclassified;
              const BadgeIcon = badge.icon;
              return (
                <tr
                  key={item.menuItemId}
                  onClick={() => onSelect(item)}
                  className="hover:bg-stone-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium text-stone-800">{item.name}</td>
                  <td className="px-3 py-2.5 text-stone-500">{item.category}</td>
                  <td className="px-3 py-2.5 text-stone-700">${item.sellingPrice.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    <span className={item.foodCostPct > 35 ? "text-red-600 font-medium" : "text-stone-700"}>
                      {item.foodCostPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-stone-700">${item.contributionMargin.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min="0"
                      value={item.unitsSold}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onUpdateSales(item.menuItemId, parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 text-sm border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-stone-500">{item.menuMixPct.toFixed(1)}%</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
                      <BadgeIcon className="size-3" />
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(item.menuItemId); }}
                      className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-stone-400">No menu items yet. Add your first item above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
