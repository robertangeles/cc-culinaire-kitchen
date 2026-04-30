/**
 * @module components/menu/MenuItemList
 *
 * Full table/list of menu items with sortable columns,
 * category filter pills, search, and classification badges.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Star,
  TrendingDown,
  HelpCircle,
  XCircle,
  Loader2,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import type { MenuItem } from "../../hooks/useMenuItems.js";
import { AllergenBadges } from "./AllergenBadges.js";

/* ---- Classification badge config ---- */

const CLASS_BADGES: Record<
  string,
  { label: string; bg: string; text: string; icon: typeof Star }
> = {
  star: {
    label: "Star",
    bg: "bg-[#D4A574]/15",
    text: "text-[#D4A574]",
    icon: Star,
  },
  plowhorse: {
    label: "Plowhorse",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    icon: TrendingDown,
  },
  puzzle: {
    label: "Puzzle",
    bg: "bg-purple-500/15",
    text: "text-purple-400",
    icon: HelpCircle,
  },
  dog: {
    label: "Dog",
    bg: "bg-[#2A2A2A]",
    text: "text-[#666666]",
    icon: XCircle,
  },
  unclassified: {
    label: "\u2014",
    bg: "bg-[#2A2A2A]",
    text: "text-[#666666]",
    icon: HelpCircle,
  },
};

type SortKey =
  | "name"
  | "category"
  | "sellingPrice"
  | "foodCost"
  | "foodCostPct"
  | "contributionMargin"
  | "unitsSold"
  | "classification";

/** Waste impact data per menu item (from backend). */
export interface WasteImpact {
  menuItemId: string;
  wasteEstimate: number;
}

interface MenuItemListProps {
  items: MenuItem[];
  loading: boolean;
  categoryTargets: Record<string, number>;
  wasteImpacts?: WasteImpact[];
  classificationFilter?: string;
  onAdd: () => void;
  onEdit: (item: MenuItem) => void;
  onDelete: (id: string) => void;
  onSelect: (item: MenuItem) => void;
}

export function MenuItemList({
  items,
  loading,
  categoryTargets,
  wasteImpacts,
  classificationFilter: initialClassFilter,
  onAdd,
  onEdit,
  onDelete,
  onSelect,
}: MenuItemListProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [classFilter, setClassFilter] = useState(initialClassFilter ?? "");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Build a waste impact lookup map
  const wasteMap = useMemo(() => {
    const map = new Map<string, number>();
    if (wasteImpacts) {
      for (const w of wasteImpacts) map.set(w.menuItemId, w.wasteEstimate);
    }
    return map;
  }, [wasteImpacts]);

  // Derive unique categories
  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category));
    return Array.from(cats).sort();
  }, [items]);

  // Filter and sort
  const filtered = useMemo(() => {
    let list = items;

    if (categoryFilter) {
      list = list.filter((i) => i.category === categoryFilter);
    }

    if (classFilter) {
      list = list.filter((i) => i.classification === classFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q)
      );
    }

    const sorted = [...list].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const cmp =
        typeof va === "string"
          ? va.localeCompare(vb as string)
          : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [items, categoryFilter, classFilter, searchQuery, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  const COLUMNS: [SortKey, string][] = [
    ["name", "Name"],
    ["category", "Category"],
    ["sellingPrice", "Price"],
    ["foodCost", "Food Cost"],
    ["foodCostPct", "FC %"],
    ["contributionMargin", "CM"],
    ["unitsSold", "Units Sold"],
    ["classification", "Class"],
  ];

  const hasWasteData = wasteImpacts && wasteImpacts.length > 0;

  return (
    <div className="space-y-4">
      {/* Search + Add button + category pills */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666666]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search menu items..."
            className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]/50 min-h-[44px]"
          />
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#D4A574] hover:bg-[#C4956A] text-white rounded-xl transition-colors min-h-[44px]"
        >
          <Plus className="size-4" />
          Add Menu Item
        </button>
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter("")}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors min-h-[36px] ${
              !categoryFilter
                ? "bg-[#D4A574] text-white"
                : "bg-[#161616] text-[#999999] hover:text-[#E5E5E5] hover:bg-[#1E1E1E] border border-[#2A2A2A]"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setCategoryFilter(categoryFilter === cat ? "" : cat)
              }
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors min-h-[36px] ${
                categoryFilter === cat
                  ? "bg-[#D4A574] text-white"
                  : "bg-[#161616] text-[#999999] hover:text-[#E5E5E5] hover:bg-[#1E1E1E] border border-[#2A2A2A]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Classification filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setClassFilter("")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[32px] ${
            !classFilter
              ? "bg-[#2A2A2A] text-[#E5E5E5]"
              : "bg-[#161616] text-[#666666] hover:text-[#999999] border border-[#2A2A2A]"
          }`}
        >
          All Classes
        </button>
        {(["star", "plowhorse", "puzzle", "dog"] as const).map((cls) => {
          const cfg = CLASS_BADGES[cls];
          return (
            <button
              key={cls}
              onClick={() => setClassFilter(classFilter === cls ? "" : cls)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[32px] ${
                classFilter === cls
                  ? `${cfg.bg} ${cfg.text}`
                  : "bg-[#161616] text-[#666666] hover:text-[#999999] border border-[#2A2A2A]"
              }`}
            >
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2A2A2A]">
                {COLUMNS.map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="px-4 py-3 text-left text-xs font-medium text-[#666666] uppercase cursor-pointer hover:text-[#999999] select-none transition-colors"
                  >
                    <span className="flex items-center gap-1">
                      {label} <SortIcon col={key} />
                    </span>
                  </th>
                ))}
                {hasWasteData && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-[#666666] uppercase select-none">
                    Waste
                  </th>
                )}
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2A2A]/50">
              {filtered.map((item) => {
                const badge =
                  CLASS_BADGES[item.classification] ??
                  CLASS_BADGES.unclassified;
                const BadgeIcon = badge.icon;
                const target = categoryTargets[item.category];
                const exceedsTarget =
                  target !== undefined && item.foodCostPct > target;

                return (
                  <tr
                    key={item.menuItemId}
                    onClick={() => onSelect(item)}
                    className="hover:bg-[#1E1E1E] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[#FAFAFA]">
                      <div>{item.name}</div>
                      <AllergenBadges item={item} className="mt-1 flex flex-wrap items-center gap-1" />
                    </td>
                    <td className="px-4 py-3 text-[#999999]">
                      {item.category}
                    </td>
                    <td className="px-4 py-3 text-[#FAFAFA]">
                      ${item.sellingPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-[#FAFAFA]">
                      ${item.foodCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          exceedsTarget
                            ? "text-red-400 font-semibold"
                            : "text-[#FAFAFA]"
                        }
                      >
                        {item.foodCostPct.toFixed(1)}%
                        {exceedsTarget && (
                          <span className="ml-1 text-[10px]" title={`Exceeds ${target}% target`}>
                            !
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#FAFAFA]">
                      ${item.contributionMargin.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-[#999999]">
                      {item.unitsSold}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        <BadgeIcon className="size-3" />
                        {badge.label}
                      </span>
                    </td>
                    {/* Waste impact column */}
                    {hasWasteData && (
                      <td className="px-4 py-3">
                        {(() => {
                          const waste = wasteMap.get(item.menuItemId);
                          if (!waste || waste <= 0) return null;
                          const isDog = item.classification === "dog";
                          if (isDog) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400"
                                title="Dog + High Waste — strong candidate for removal"
                              >
                                <AlertTriangle className="size-3" />
                                Dog + ${waste.toFixed(0)} waste
                              </span>
                            );
                          }
                          return (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400">
                              ${waste.toFixed(0)} wasted
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {item.classification === "dog" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const target = categoryTargets[item.category] ?? 30;
                              navigate(
                                `/recipes?replaceDog=true&category=${encodeURIComponent(item.category)}&targetFoodCostPct=${target}`
                              );
                            }}
                            className="p-2 rounded-lg hover:bg-[#D4A574]/10 text-[#D4A574] hover:text-[#C4956A] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                            title="Generate replacement recipe"
                          >
                            <Sparkles className="size-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(item);
                          }}
                          className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-[#D4A574] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                          title="Edit"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.menuItemId);
                          }}
                          disabled={deletingId === item.menuItemId}
                          className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#666666] hover:text-red-400 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === item.menuItemId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={hasWasteData ? 11 : 10}
                    className="px-4 py-12 text-center text-[#666666]"
                  >
                    {items.length === 0
                      ? "No menu items yet. Start building your menu to unlock engineering insights."
                      : "No items match your search or filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
