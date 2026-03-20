/**
 * @module components/copilot/PrepMenuSelector
 *
 * Menu-driven dish selection for prep session planning.
 * Fetches menu items (or falls back to recipes), lets the chef
 * select dishes, set portion counts, and generate a prep list.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MenuItem {
  menuItemId: string;
  name: string;
  category: string;
  classification: string | null;
  foodCostPct: number | null;
}

interface Recipe {
  recipeId: string;
  title: string;
  domain: string;
}

interface MenuPayload {
  menuItems: MenuItem[];
  recipes: Recipe[];
  hasMenuItems: boolean;
}

interface Selection {
  dishName: string;
  expectedPortions: number;
  recipeId?: string;
  menuItemId?: string;
  category?: string;
}

interface PreviousSelection {
  dishName: string;
  expectedPortions: number;
  recipeId?: string;
  menuItemId?: string;
  category?: string;
}

interface Props {
  sessionId: string;
  onGenerated: (sessionData: any) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CLASSIFICATION_BADGE: Record<string, { bg: string; text: string }> = {
  Star: { bg: "bg-[#D4A574]/15", text: "text-[#D4A574]" },
  Plowhorse: { bg: "bg-blue-500/15", text: "text-blue-400" },
  Puzzle: { bg: "bg-purple-500/15", text: "text-purple-400" },
  Dog: { bg: "bg-[#2A2A2A]", text: "text-[#666666]" },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PrepMenuSelector({ sessionId, onGenerated }: Props) {
  /* ---- data state ---- */
  const [menuData, setMenuData] = useState<MenuPayload | null>(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  /* ---- UI state ---- */
  const [source, setSource] = useState<"menu" | "recipes">("menu");
  const [selected, setSelected] = useState<Map<string, number>>(new Map()); // key -> portions
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [loadingPrevious, setLoadingPrevious] = useState(false);

  /* ---- helpers to build a stable key for each dish ---- */
  const menuKey = (mi: MenuItem) => `mi:${mi.menuItemId}`;
  const recipeKey = (r: Recipe) => `r:${r.recipeId}`;

  /* ---------------------------------------------------------------- */
  /*  Fetch menu + recipes on mount                                    */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    (async () => {
      setLoadingMenu(true);
      setMenuError(null);
      try {
        const res = await fetch("/api/prep/menu", { credentials: "include" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
        }
        const data: MenuPayload = await res.json();
        setMenuData(data);
        setSource(data.hasMenuItems ? "menu" : "recipes");
      } catch (err) {
        setMenuError(err instanceof Error ? err.message : "Failed to load menu");
      } finally {
        setLoadingMenu(false);
      }
    })();
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Selection helpers                                                */
  /* ---------------------------------------------------------------- */
  const toggleItem = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, 1);
      }
      return next;
    });
  }, []);

  const setPortions = useCallback((key: string, portions: number) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (portions < 1) {
        next.delete(key);
      } else {
        next.set(key, portions);
      }
      return next;
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  "Use Yesterday's Selection"                                      */
  /* ---------------------------------------------------------------- */
  const loadPreviousSelections = useCallback(async () => {
    setLoadingPrevious(true);
    try {
      const res = await fetch("/api/prep/previous-selections", { credentials: "include" });
      if (!res.ok) return;
      const data: { selections: PreviousSelection[] } = await res.json();
      if (!data.selections || data.selections.length === 0) return;

      const next = new Map<string, number>();
      for (const sel of data.selections) {
        if (sel.menuItemId) {
          next.set(`mi:${sel.menuItemId}`, sel.expectedPortions);
        } else if (sel.recipeId) {
          next.set(`r:${sel.recipeId}`, sel.expectedPortions);
        }
      }
      setSelected(next);
    } catch {
      // silent
    } finally {
      setLoadingPrevious(false);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Generate prep list                                               */
  /* ---------------------------------------------------------------- */
  const generatePrepList = useCallback(async () => {
    if (!menuData || selected.size === 0) return;
    setGenerating(true);
    setGenError(null);

    try {
      // Build selections payload
      const selections: Selection[] = [];

      selected.forEach((portions, key) => {
        if (key.startsWith("mi:")) {
          const id = key.slice(3);
          const mi = menuData.menuItems.find((m) => m.menuItemId === id);
          if (mi) {
            selections.push({
              menuItemId: mi.menuItemId,
              dishName: mi.name,
              expectedPortions: portions,
              category: mi.category,
            });
          }
        } else if (key.startsWith("r:")) {
          const id = key.slice(2);
          const r = menuData.recipes.find((rec) => rec.recipeId === id);
          if (r) {
            selections.push({
              recipeId: r.recipeId,
              dishName: r.title,
              expectedPortions: portions,
            });
          }
        }
      });

      // Save selections
      const selRes = await fetch(`/api/prep/sessions/${sessionId}/selections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selections }),
      });
      if (!selRes.ok) {
        const json = await selRes.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed to save selections (${selRes.status})`);
      }

      // Generate tasks
      const genRes = await fetch(`/api/prep/sessions/${sessionId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!genRes.ok) {
        const json = await genRes.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed to generate tasks (${genRes.status})`);
      }

      const sessionData = await genRes.json();
      onGenerated(sessionData);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate prep list");
    } finally {
      setGenerating(false);
    }
  }, [menuData, selected, sessionId, onGenerated]);

  /* ---------------------------------------------------------------- */
  /*  Grouped + filtered data                                          */
  /* ---------------------------------------------------------------- */
  const filteredMenuGroups = useMemo(() => {
    if (!menuData) return [];
    const q = searchQuery.toLowerCase().trim();

    const items = menuData.menuItems.filter(
      (mi) => !q || mi.name.toLowerCase().includes(q) || mi.category.toLowerCase().includes(q),
    );

    const grouped = new Map<string, MenuItem[]>();
    for (const mi of items) {
      const cat = mi.category || "Uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(mi);
    }

    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [menuData, searchQuery]);

  const filteredRecipeGroups = useMemo(() => {
    if (!menuData) return [];
    const q = searchQuery.toLowerCase().trim();

    const items = menuData.recipes.filter(
      (r) => !q || r.title.toLowerCase().includes(q) || r.domain.toLowerCase().includes(q),
    );

    const grouped = new Map<string, Recipe[]>();
    for (const r of items) {
      const domain = r.domain || "General";
      if (!grouped.has(domain)) grouped.set(domain, []);
      grouped.get(domain)!.push(r);
    }

    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [menuData, searchQuery]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const selectedCount = selected.size;

  /* ---------------------------------------------------------------- */
  /*  Loading state                                                    */
  /* ---------------------------------------------------------------- */
  if (loadingMenu) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-8 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        {menuError}
      </div>
    );
  }

  if (!menuData) return null;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-white">
          What&apos;s on the menu today?
        </h2>
        <p className="text-[#999999] text-sm mt-1">
          Select the dishes you&apos;re serving and set portion counts
        </p>
      </div>

      {/* Source toggle + quick actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        {/* Source toggle — only when menu items exist */}
        {menuData.hasMenuItems && (
          <div className="flex rounded-xl overflow-hidden border border-[#2A2A2A]">
            <button
              onClick={() => setSource("menu")}
              className={`px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                source === "menu"
                  ? "bg-[#D4A574] text-[#0A0A0A]"
                  : "bg-[#0A0A0A] text-[#999999] hover:text-white"
              }`}
            >
              Menu Items
            </button>
            <button
              onClick={() => setSource("recipes")}
              className={`px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                source === "recipes"
                  ? "bg-[#D4A574] text-[#0A0A0A]"
                  : "bg-[#0A0A0A] text-[#999999] hover:text-white"
              }`}
            >
              My Recipes
            </button>
          </div>
        )}

        {/* Use yesterday's */}
        <button
          onClick={loadPreviousSelections}
          disabled={loadingPrevious}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1E1E1E] text-[#999999] hover:text-white rounded-xl text-sm transition-colors min-h-[44px]"
        >
          {loadingPrevious ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          Use Yesterday&apos;s Selection
        </button>

        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666666]" />
          <input
            type="text"
            placeholder="Search dishes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-white text-sm placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent min-h-[44px]"
          />
        </div>
      </div>

      {/* Recipes-only banner */}
      {!menuData.hasMenuItems && (
        <div className="bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl p-4 mb-6">
          <p className="text-sm text-[#D4A574]">
            Set up your menu in Menu Intelligence for classification badges and cost data.
          </p>
        </div>
      )}

      {/* Dish list */}
      <div className="max-h-[50vh] overflow-y-auto space-y-4 mb-6 pr-1">
        {source === "menu" && menuData.hasMenuItems ? (
          /* ---------- Menu Items grouped by category ---------- */
          filteredMenuGroups.length === 0 ? (
            <p className="text-center text-[#666666] py-8 text-sm">
              No dishes match your search.
            </p>
          ) : (
            filteredMenuGroups.map(([category, items]) => {
              const isCollapsed = collapsedCategories.has(category);
              return (
                <div key={category}>
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="flex items-center gap-2 w-full text-left mb-2 group"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4 text-[#666666]" />
                    ) : (
                      <ChevronDown className="size-4 text-[#666666]" />
                    )}
                    <span className="text-xs uppercase tracking-wider text-[#666666] font-semibold">
                      {category}
                    </span>
                    <span className="text-xs text-[#666666]">({items.length})</span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-1">
                      {items.map((mi) => {
                        const key = menuKey(mi);
                        const isSelected = selected.has(key);
                        const portions = selected.get(key) ?? 1;

                        return (
                          <div
                            key={mi.menuItemId}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                              isSelected ? "bg-[#D4A574]/10" : "hover:bg-[#0A0A0A]"
                            }`}
                          >
                            {/* Checkbox */}
                            <button
                              onClick={() => toggleItem(key)}
                              className={`shrink-0 size-5 rounded border-2 flex items-center justify-center transition-colors min-h-[44px] min-w-[44px] ${
                                isSelected
                                  ? "bg-[#D4A574] border-[#D4A574]"
                                  : "bg-[#0A0A0A] border-[#2A2A2A] hover:border-[#D4A574]"
                              }`}
                              aria-label={isSelected ? `Deselect ${mi.name}` : `Select ${mi.name}`}
                            >
                              {isSelected && (
                                <svg className="size-3 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>

                            {/* Name */}
                            <span className="flex-1 text-sm font-semibold text-white min-w-0 truncate">
                              {mi.name}
                            </span>

                            {/* Classification badge */}
                            {mi.classification && CLASSIFICATION_BADGE[mi.classification] && (
                              <span
                                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${CLASSIFICATION_BADGE[mi.classification].bg} ${CLASSIFICATION_BADGE[mi.classification].text}`}
                              >
                                {mi.classification}
                              </span>
                            )}

                            {/* Food cost badge */}
                            {mi.foodCostPct != null && (
                              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-[#1E1E1E] text-[#999999]">
                                {Number(mi.foodCostPct).toFixed(1)}% cost
                              </span>
                            )}

                            {/* Portion input */}
                            {isSelected && (
                              <input
                                type="number"
                                min={1}
                                value={portions}
                                onChange={(e) => setPortions(key, Number(e.target.value) || 0)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-20 px-3 py-1.5 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-center text-white text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent min-h-[44px]"
                                aria-label={`Portions for ${mi.name}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          /* ---------- Recipes grouped by domain ---------- */
          filteredRecipeGroups.length === 0 ? (
            <p className="text-center text-[#666666] py-8 text-sm">
              No recipes match your search.
            </p>
          ) : (
            filteredRecipeGroups.map(([domain, recipes]) => {
              const isCollapsed = collapsedCategories.has(domain);
              return (
                <div key={domain}>
                  {/* Domain header */}
                  <button
                    onClick={() => toggleCategory(domain)}
                    className="flex items-center gap-2 w-full text-left mb-2 group"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4 text-[#666666]" />
                    ) : (
                      <ChevronDown className="size-4 text-[#666666]" />
                    )}
                    <span className="text-xs uppercase tracking-wider text-[#666666] font-semibold">
                      {domain}
                    </span>
                    <span className="text-xs text-[#666666]">({recipes.length})</span>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-1">
                      {recipes.map((r) => {
                        const key = recipeKey(r);
                        const isSelected = selected.has(key);
                        const portions = selected.get(key) ?? 1;

                        return (
                          <div
                            key={r.recipeId}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                              isSelected ? "bg-[#D4A574]/10" : "hover:bg-[#0A0A0A]"
                            }`}
                          >
                            {/* Checkbox */}
                            <button
                              onClick={() => toggleItem(key)}
                              className={`shrink-0 size-5 rounded border-2 flex items-center justify-center transition-colors min-h-[44px] min-w-[44px] ${
                                isSelected
                                  ? "bg-[#D4A574] border-[#D4A574]"
                                  : "bg-[#0A0A0A] border-[#2A2A2A] hover:border-[#D4A574]"
                              }`}
                              aria-label={isSelected ? `Deselect ${r.title}` : `Select ${r.title}`}
                            >
                              {isSelected && (
                                <svg className="size-3 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>

                            {/* Title */}
                            <span className="flex-1 text-sm font-semibold text-white min-w-0 truncate">
                              {r.title}
                            </span>

                            {/* Portion input */}
                            {isSelected && (
                              <input
                                type="number"
                                min={1}
                                value={portions}
                                onChange={(e) => setPortions(key, Number(e.target.value) || 0)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-20 px-3 py-1.5 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl text-center text-white text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent min-h-[44px]"
                                aria-label={`Portions for ${r.title}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )
        )}
      </div>

      {/* Error */}
      {genError && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">
          {genError}
        </div>
      )}

      {/* Sticky footer */}
      <div className="border-t border-[#2A2A2A] pt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-[#999999]">
          {selectedCount > 0
            ? `${selectedCount} dish${selectedCount !== 1 ? "es" : ""} selected`
            : "No dishes selected"}
        </p>
        <button
          onClick={generatePrepList}
          disabled={generating || selectedCount === 0}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4A574] hover:bg-[#C4956A] disabled:bg-[#2A2A2A] disabled:text-[#666666] disabled:cursor-not-allowed text-[#0A0A0A] font-semibold rounded-xl transition-colors min-h-[44px]"
        >
          {generating ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Sparkles className="size-5" />
          )}
          Generate Prep List
        </button>
      </div>
    </div>
  );
}
