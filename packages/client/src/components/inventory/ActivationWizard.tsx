/**
 * @module components/inventory/ActivationWizard
 *
 * Full org-wide catalog with per-item toggle switches.
 * Staff activate/deactivate which items their location carries.
 * Debounced batch writes prevent excessive API calls.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  Package, Search, Copy, Check, X, ChevronDown, ChevronRight,
  Loader2, ToggleLeft, ToggleRight, Layers, Filter,
} from "lucide-react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  ITEM_TYPES,
  ITEM_TYPE_KEYS,
  getItemTypeStyle,
  getCategoriesForType,
  type ItemTypeKey,
} from "@culinaire/shared";

// ─── API Config ──────────────────────────────────────────────

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ───────────────────────────────────────────────────

interface CatalogItem {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  itemType: string;
}

interface ActivationStatus {
  total: number;
  activated: number;
  byType: Record<string, number>;
}

type TabFilter = "ALL" | ItemTypeKey;

// ─── Component ───────────────────────────────────────────────

export function ActivationWizard() {
  const { selectedLocationId, locations } = useLocation();

  // ── Data state ──
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [localActiveMap, setLocalActiveMap] = useState<Record<string, boolean>>({});
  const [activationStatus, setActivationStatus] = useState<ActivationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<TabFilter>("ALL");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string | "">("");
  const [copySourceId, setCopySourceId] = useState("");
  const [copying, setCopying] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // ── Debounced batch write refs ──
  const pendingRef = useRef<{ activate: Set<string>; deactivate: Set<string> }>({
    activate: new Set(),
    deactivate: new Set(),
  });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Fetch helpers ──
  const fetchCatalog = useCallback(async () => {
    const res = await fetch(`${API}/ingredients`, opts);
    if (!res.ok) throw new Error("Failed to load catalog");
    const data = await res.json();
    return (data.ingredients ?? data) as CatalogItem[];
  }, []);

  const fetchLocationItems = useCallback(async (locId: string) => {
    const res = await fetch(`${API}/locations/${locId}/ingredients?activeOnly=false`, opts);
    if (!res.ok) throw new Error("Failed to load location items");
    const data = await res.json();
    return (data.ingredients ?? data) as Array<{ ingredientId: string; isActive?: boolean }>;
  }, []);

  const fetchStatus = useCallback(async (locId: string) => {
    const res = await fetch(`${API}/locations/${locId}/activation-status`, opts);
    if (!res.ok) return null;
    return (await res.json()) as ActivationStatus;
  }, []);

  // ── Initial load ──
  useEffect(() => {
    if (!selectedLocationId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [catalogData, locItems, status] = await Promise.all([
          fetchCatalog(),
          fetchLocationItems(selectedLocationId),
          fetchStatus(selectedLocationId),
        ]);
        if (cancelled) return;

        setCatalog(catalogData);

        // Build active map: items present in location data with isActive flag
        const map: Record<string, boolean> = {};
        for (const item of locItems) {
          map[item.ingredientId] = item.isActive !== false;
        }
        setLocalActiveMap(map);
        if (status) setActivationStatus(status);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedLocationId, fetchCatalog, fetchLocationItems, fetchStatus]);

  // ── Flush pending changes ──
  const flush = useCallback(async () => {
    if (!selectedLocationId) return;
    const { activate, deactivate } = pendingRef.current;
    pendingRef.current = { activate: new Set(), deactivate: new Set() };

    const promises: Promise<Response>[] = [];
    if (activate.size) {
      promises.push(
        fetch(`${API}/locations/${selectedLocationId}/activate-items`, {
          ...jsonOpts,
          method: "POST",
          body: JSON.stringify({ ingredientIds: [...activate] }),
        }),
      );
    }
    if (deactivate.size) {
      promises.push(
        fetch(`${API}/locations/${selectedLocationId}/deactivate-items`, {
          ...jsonOpts,
          method: "POST",
          body: JSON.stringify({ ingredientIds: [...deactivate] }),
        }),
      );
    }
    if (promises.length) {
      await Promise.all(promises);
      // Refresh status
      const status = await fetchStatus(selectedLocationId);
      if (status) setActivationStatus(status);
    }
  }, [selectedLocationId, fetchStatus]);

  // Flush on unmount
  useEffect(() => () => { flush(); }, [flush]);

  // ── Toggle handler ──
  function toggle(ingredientId: string, active: boolean) {
    setLocalActiveMap((prev) => ({ ...prev, [ingredientId]: active }));

    if (active) {
      pendingRef.current.activate.add(ingredientId);
      pendingRef.current.deactivate.delete(ingredientId);
    } else {
      pendingRef.current.deactivate.add(ingredientId);
      pendingRef.current.activate.delete(ingredientId);
    }

    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 500);
  }

  // ── Bulk toggle helpers ──
  function activateAll(ids: string[]) {
    const next = { ...localActiveMap };
    for (const id of ids) {
      next[id] = true;
      pendingRef.current.activate.add(id);
      pendingRef.current.deactivate.delete(id);
    }
    setLocalActiveMap(next);
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 500);
  }

  function deactivateAll(ids: string[]) {
    const next = { ...localActiveMap };
    for (const id of ids) {
      next[id] = false;
      pendingRef.current.deactivate.add(id);
      pendingRef.current.activate.delete(id);
    }
    setLocalActiveMap(next);
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 500);
  }

  // ── Category collapse toggle ──
  function toggleCat(cat: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  // ── Copy from location ──
  async function handleCopyActivation() {
    if (!selectedLocationId || !copySourceId) return;
    setCopying(true);
    setCopySuccess(false);
    try {
      const res = await fetch(`${API}/locations/${selectedLocationId}/copy-activation`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ sourceLocationId: copySourceId }),
      });
      if (!res.ok) throw new Error("Copy failed");

      // Reload data
      const [locItems, status] = await Promise.all([
        fetchLocationItems(selectedLocationId),
        fetchStatus(selectedLocationId),
      ]);
      const map: Record<string, boolean> = {};
      for (const item of locItems) map[item.ingredientId] = item.isActive !== false;
      setLocalActiveMap(map);
      if (status) setActivationStatus(status);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    } catch (err: any) {
      setError(err.message ?? "Copy failed");
    } finally {
      setCopying(false);
    }
  }

  // ── Filtering ──
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      if (activeTab !== "ALL" && item.itemType !== activeTab) return false;
      if (filterCat && item.ingredientCategory !== filterCat) return false;
      if (search && !item.ingredientName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [catalog, activeTab, filterCat, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of filteredCatalog) {
      if (!map.has(item.ingredientCategory)) map.set(item.ingredientCategory, []);
      map.get(item.ingredientCategory)!.push(item);
    }
    return map;
  }, [filteredCatalog]);

  // Available categories for filter dropdown
  const availableCategories = useMemo(() => {
    if (activeTab === "ALL") return CATEGORIES;
    return getCategoriesForType(activeTab);
  }, [activeTab]);

  // ── Computed progress ──
  const totalItems = catalog.length;
  const activatedCount = Object.values(localActiveMap).filter(Boolean).length;
  const progressPct = totalItems > 0 ? (activatedCount / totalItems) * 100 : 0;

  // Per-type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of catalog) {
      if (localActiveMap[item.ingredientId]) {
        counts[item.itemType] = (counts[item.itemType] || 0) + 1;
      }
    }
    return counts;
  }, [catalog, localActiveMap]);

  // Other locations for copy dropdown
  const otherLocations = locations.filter((l) => l.storeLocationId !== selectedLocationId);

  // ── Tab definitions ──
  const tabs: { key: TabFilter; label: string; color: string; borderColor: string }[] = [
    { key: "ALL", label: "All", color: "text-white", borderColor: "border-white" },
    { key: "KITCHEN_INGREDIENT", label: "Kitchen", color: "text-emerald-400", borderColor: "border-emerald-400" },
    { key: "FOH_CONSUMABLE", label: "FOH", color: "text-sky-400", borderColor: "border-sky-400" },
    { key: "OPERATIONAL_SUPPLY", label: "Operational", color: "text-amber-400", borderColor: "border-amber-400" },
  ];

  // ── Render ─────────────────────────────────────────────────

  if (!selectedLocationId) {
    return (
      <div className="flex items-center justify-center h-64 text-[#666]">
        <p>Select a location to manage item activation.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-[#888]">
        <Loader2 className="size-5 animate-spin" />
        <span>Loading catalog...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <X className="size-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto hover:text-red-300">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── Progress Counter ── */}
      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Package className="size-4 text-[#D4A574]" />
              <span className="text-sm font-medium text-white">
                {activatedCount} of {totalItems} items activated
              </span>
            </div>
            <div className="flex gap-3 text-xs text-[#888]">
              {ITEM_TYPE_KEYS.map((type) => {
                const style = getItemTypeStyle(type);
                return (
                  <span key={type} className={style.textClass}>
                    {style.label.split(" ")[0]}: {typeCounts[type] || 0}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Copy from location */}
          <div className="flex items-center gap-2">
            <select
              value={copySourceId}
              onChange={(e) => setCopySourceId(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#161616] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50 transition-all"
            >
              <option value="">Copy from...</option>
              {otherLocations.map((loc) => (
                <option key={loc.storeLocationId} value={loc.storeLocationId}>
                  {loc.locationName}
                </option>
              ))}
            </select>
            <button
              onClick={handleCopyActivation}
              disabled={!copySourceId || copying}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#1A1A1A] border border-[#2A2A2A] text-[#ccc] hover:border-[#D4A574]/40 hover:text-white"
            >
              {copying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : copySuccess ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <Copy className="size-3.5" />
              )}
              <span>{copying ? "Copying..." : copySuccess ? "Copied!" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-[#1A1A1A] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${progressPct}%`,
              background: `linear-gradient(to right, #10b981, #f59e0b)`,
            }}
          />
        </div>
      </div>

      {/* ── Filter Tabs ── */}
      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 space-y-3">
        {/* Type tabs */}
        <div className="flex gap-1 border-b border-[#2A2A2A] pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setFilterCat("");
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-t-lg transition-all border-b-2 ${
                activeTab === tab.key
                  ? `${tab.color} ${tab.borderColor}`
                  : "text-[#666] border-transparent hover:text-[#999]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + category filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#666] hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666] pointer-events-none" />
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="pl-9 pr-8 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white focus:outline-none focus:border-[#D4A574]/50 transition-all appearance-none cursor-pointer"
            >
              <option value="">All Categories</option>
              {availableCategories.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-[#666] pointer-events-none" />
          </div>
        </div>
      </div>

      {/* ── Items List — Grouped by Category ── */}
      {grouped.size === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-[#666] gap-2">
          <Layers className="size-8 opacity-40" />
          <p className="text-sm">No items match your filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...grouped.entries()].map(([category, items]) => {
            const categoryIds = items.map((i) => i.ingredientId);
            const activatedInCat = categoryIds.filter((id) => localActiveMap[id]).length;
            const allActive = activatedInCat === categoryIds.length;
            const noneActive = activatedInCat === 0;
            const isExpanded = expandedCats.has(category);

            return (
              <div
                key={category}
                className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl overflow-hidden"
              >
                {/* Category header — collapsible toggle */}
                <div
                  className="flex items-center justify-between cursor-pointer hover:bg-[#1A1A1A] transition-colors rounded-lg px-3 py-2 bg-gradient-to-r from-white/[0.03] to-transparent"
                  onClick={() => toggleCat(category)}
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronDown className="size-4 text-[#888] shrink-0 transition-transform" />
                    ) : (
                      <ChevronRight className="size-4 text-[#888] shrink-0 transition-transform" />
                    )}
                    <span className="text-sm font-medium text-[#ccc]">
                      {CATEGORY_LABELS[category] || category}
                    </span>
                    <span className="text-xs text-[#666]">
                      ({activatedInCat} of {items.length} activated)
                    </span>
                  </div>
                  <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => activateAll(categoryIds)}
                      disabled={allActive}
                      className="px-2.5 py-1 text-xs rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                    >
                      Activate All
                    </button>
                    <button
                      onClick={() => deactivateAll(categoryIds)}
                      disabled={noneActive}
                      className="px-2.5 py-1 text-xs rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                    >
                      Deactivate All
                    </button>
                  </div>
                </div>

                {/* Item rows — only visible when expanded */}
                {isExpanded && (
                  <div className="divide-y divide-white/[0.03] border-t border-white/5">
                    {items.map((item) => {
                      const isActive = !!localActiveMap[item.ingredientId];
                      const typeStyle = getItemTypeStyle(item.itemType);

                      return (
                        <div
                          key={item.ingredientId}
                          className="flex items-center gap-3 px-4 py-2.5 hover:-translate-y-0.5 transition-all duration-200 group"
                        >
                          {/* Toggle switch */}
                          <button
                            onClick={() => toggle(item.ingredientId, !isActive)}
                            className="shrink-0 focus:outline-none"
                            aria-label={isActive ? "Deactivate" : "Activate"}
                          >
                            {isActive ? (
                              <ToggleRight
                                className="size-6 text-amber-400 transition-all shadow-[0_0_8px_rgba(255,214,10,0.2)]"
                              />
                            ) : (
                              <ToggleLeft
                                className="size-6 text-[#444] transition-all hover:text-[#666]"
                              />
                            )}
                          </button>

                          {/* Item name */}
                          <span
                            className={`flex-1 text-sm transition-colors ${
                              isActive ? "text-white" : "text-[#555]"
                            }`}
                          >
                            {item.ingredientName}
                          </span>

                          {/* Category badge */}
                          <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] rounded-full bg-white/[0.04] text-[#888] border border-white/5">
                            {CATEGORY_LABELS[item.ingredientCategory] || item.ingredientCategory}
                          </span>

                          {/* Base unit */}
                          <span className="text-xs text-[#666] w-10 text-right">
                            {item.baseUnit}
                          </span>

                          {/* Item type pill */}
                          <span
                            className={`px-2 py-0.5 text-[10px] rounded-full border ${typeStyle.bgClass} ${typeStyle.textClass} ${typeStyle.borderClass}`}
                          >
                            {typeStyle.label.split(" ")[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
