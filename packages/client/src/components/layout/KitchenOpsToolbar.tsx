/**
 * @module components/layout/KitchenOpsToolbar
 *
 * Shared command strip for all Kitchen Operations pages.
 * Shows the current location selector (always visible) and
 * the active module name. Extensible for future tools.
 */

import { useState, useRef, useEffect } from "react";
import { useLocation as useRouterLocation } from "react-router";
import { MapPin, ChevronDown, Search, Building2 } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";

const CLASSIFICATION_BADGE: Record<string, { bg: string; label: string }> = {
  hq: { bg: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "HQ" },
  branch: { bg: "bg-sky-500/20 text-sky-400 border-sky-500/30", label: "Branch" },
  commissary: { bg: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Commissary" },
  satellite: { bg: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Satellite" },
};

const MODULE_MAP: Record<string, string> = {
  "/inventory": "Inventory",
  "/menu-intelligence": "Menu Intelligence",
  "/kitchen-copilot": "Kitchen Copilot",
  "/waste-intelligence": "Waste Intelligence",
};

function getModuleName(pathname: string): string {
  for (const [prefix, name] of Object.entries(MODULE_MAP)) {
    if (pathname.startsWith(prefix)) return name;
  }
  return "Kitchen Operations";
}

export function KitchenOpsToolbar() {
  const { pathname } = useRouterLocation();
  const {
    locations,
    selectedLocation,
    selectedLocationId,
    isOrgAdmin,
    switchLocation,
  } = useLocation();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const moduleName = getModuleName(pathname);

  const filteredLocations = locations.filter((loc) =>
    loc.locationName.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleSelect(locationId: string) {
    await switchLocation(locationId);
    setDropdownOpen(false);
    setSearch("");
  }

  // Close on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  // Focus search on open
  useEffect(() => {
    if (dropdownOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [dropdownOpen]);

  const badge = CLASSIFICATION_BADGE[selectedLocation?.classification ?? ""] ?? null;
  const hasMultiple = locations.length > 1 || isOrgAdmin;

  return (
    <div
      className="flex-shrink-0 h-11 flex items-center px-4 sm:px-6 lg:px-8 overflow-visible relative z-40"
      style={{
        background: "linear-gradient(180deg, rgba(40,34,28,0.99) 0%, rgba(30,26,22,0.99) 100%)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(212,165,116,0.2)",
        borderTop: "1px solid rgba(212,165,116,0.08)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(212,165,116,0.08)",
      }}
    >
      {/* Location selector */}
      <div ref={containerRef} className="relative flex items-center">
        <button
          onClick={() => hasMultiple && setDropdownOpen(!dropdownOpen)}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-all duration-150 ${
            hasMultiple
              ? "hover:bg-white/[0.04] cursor-pointer"
              : "cursor-default"
          } ${dropdownOpen ? "bg-white/[0.06]" : ""}`}
        >
          {/* Location color dot with pulse */}
          <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
            <span
              className="absolute w-2.5 h-2.5 rounded-full animate-ping opacity-20"
              style={{ backgroundColor: selectedLocation?.colorAccent ?? "#D4A574" }}
            />
            <span
              className="relative w-2 h-2 rounded-full"
              style={{ backgroundColor: selectedLocation?.colorAccent ?? "#D4A574" }}
            />
          </span>

          {/* Name */}
          <span className="text-sm font-medium text-white truncate max-w-[200px]">
            {selectedLocation?.locationName ?? "Select Location"}
          </span>

          {/* Classification badge */}
          {badge && (
            <span
              className={`px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider rounded border ${badge.bg}`}
            >
              {badge.label}
            </span>
          )}

          {/* Chevron */}
          {hasMultiple && (
            <ChevronDown
              className={`size-3.5 text-[#666] transition-transform duration-200 shrink-0 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          )}
        </button>

        {/* Dropdown */}
        {dropdownOpen && (
          <div
            className="absolute left-0 top-full mt-1.5 z-50 min-w-[260px] rounded-xl overflow-hidden animate-[fadeInUp_150ms_ease-out]"
            style={{
              background: "linear-gradient(135deg, rgba(22,20,18,0.98), rgba(12,11,10,0.99))",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(212,165,116,0.15)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 1px rgba(212,165,116,0.1)",
            }}
          >
            {/* Search */}
            {locations.length > 3 && (
              <div className="p-2 border-b border-white/[0.06]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#555]" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search locations..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/[0.04] border border-white/[0.06] text-white placeholder:text-[#555] focus:outline-none focus:border-[#D4A574]/30"
                  />
                </div>
              </div>
            )}

            {/* Location list */}
            <div className="max-h-64 overflow-y-auto py-1">
              {/* All Locations option */}
              {isOrgAdmin && (
                <button
                  onClick={() => handleSelect("all")}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 transition-colors ${
                    selectedLocationId === "all"
                      ? "bg-[#D4A574]/10 border-l-2 border-[#D4A574]"
                      : "hover:bg-white/[0.04] border-l-2 border-transparent"
                  }`}
                >
                  <Building2 className="size-4 text-[#D4A574] shrink-0" />
                  <span className="text-sm text-[#ccc]">All Locations</span>
                </button>
              )}

              {filteredLocations.map((loc) => {
                const isSelected = loc.storeLocationId === selectedLocationId;
                const locBadge = CLASSIFICATION_BADGE[loc.classification] ?? null;
                return (
                  <button
                    key={loc.storeLocationId}
                    onClick={() => handleSelect(loc.storeLocationId)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 transition-colors ${
                      isSelected
                        ? "bg-[#D4A574]/10 border-l-2 border-[#D4A574]"
                        : "hover:bg-white/[0.04] border-l-2 border-transparent"
                    }`}
                  >
                    {/* Color dot */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: loc.colorAccent ?? "#666" }}
                    />

                    {/* Name + badge */}
                    <div className="flex-1 text-left min-w-0">
                      <span className="text-sm text-white truncate block">{loc.locationName}</span>
                    </div>

                    {locBadge && (
                      <span
                        className={`px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wider rounded border shrink-0 ${locBadge.bg}`}
                      >
                        {locBadge.label}
                      </span>
                    )}

                    {/* Selected glow dot */}
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D4A574] shadow-[0_0_6px_rgba(212,165,116,0.5)] shrink-0" />
                    )}
                  </button>
                );
              })}

              {filteredLocations.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-[#555]">
                  No locations match
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-white/[0.08] mx-3" />

      {/* Module name */}
      <span className="text-xs text-[#666] font-medium tracking-wide">{moduleName}</span>

      {/* Right side — future extensibility */}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {/* Future: shift selector, quick actions, notification bell */}
      </div>
    </div>
  );
}
