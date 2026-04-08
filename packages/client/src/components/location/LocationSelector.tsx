/**
 * @module components/location/LocationSelector
 *
 * Dropdown location selector for Kitchen Ops modules.
 * Shows assigned locations with Kitchen Pulse, color accents,
 * and avatars.
 *
 * Behavior:
 *   1 location  → auto-selected, selector hidden
 *   2+ locations → dropdown with search
 *   Org Admin   → includes "All Locations" aggregate option
 */

import { useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown, Search, Building2 } from "lucide-react";
import { useLocation } from "../../context/LocationContext";
import { LocationPulse } from "./LocationPulse";

const CLASSIFICATION_COLORS: Record<string, string> = {
  hq: "bg-amber-600",
  branch: "bg-blue-500",
  commissary: "bg-emerald-500",
  satellite: "bg-purple-500",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  hq: "HQ",
  branch: "Branch",
  commissary: "Commissary",
  satellite: "Satellite",
};

export function LocationSelector() {
  const {
    locations,
    selectedLocation,
    selectedLocationId,
    isOrgAdmin,
    switchLocation,
  } = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredLocations = locations.filter((loc) =>
    loc.locationName.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = async (locationId: string) => {
    await switchLocation(locationId);
    setIsOpen(false);
    setSearch("");
  };

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  // Early return AFTER all hooks (Rules of Hooks compliance)
  if (locations.length <= 1 && !isOrgAdmin) return null;

  return (
    <div ref={dropdownRef} className="relative">
      {/* Selected location trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5
          bg-dark-50 border border-dark-200
          hover:border-dark-300 hover:bg-dark-100
          transition-colors duration-200"
      >
        {/* Color accent stripe */}
        {selectedLocation?.colorAccent && (
          <div
            className="w-1 h-6 rounded-full shrink-0"
            style={{ backgroundColor: selectedLocation.colorAccent }}
          />
        )}

        {/* Avatar or icon */}
        {selectedLocation?.photoPath ? (
          <img
            src={selectedLocation.photoPath}
            alt=""
            className="w-6 h-6 rounded-full object-cover shrink-0"
          />
        ) : (
          <MapPin className="w-4 h-4 text-gold shrink-0" />
        )}

        {/* Name + classification */}
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {selectedLocation?.locationName ?? "Select Location"}
          </div>
          {selectedLocation && (
            <div className="text-[10px] text-dark-500 uppercase tracking-wider">
              {CLASSIFICATION_LABELS[selectedLocation.classification] ??
                selectedLocation.classification}
            </div>
          )}
        </div>

        <ChevronDown
          className={`w-4 h-4 text-dark-500 transition-transform duration-200 shrink-0
            ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50
            bg-dark-50 border border-dark-200
            rounded-xl shadow-[0_8px_25px_-5px_rgba(0,0,0,0.4)]
            overflow-hidden animate-fade-in"
        >
          {/* Search */}
          {locations.length > 3 && (
            <div className="p-2 border-b border-dark-200">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search locations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg
                    bg-dark border border-dark-200 text-white
                    placeholder:text-dark-500
                    focus:outline-none focus:ring-1 focus:ring-gold-ring"
                />
              </div>
            </div>
          )}

          {/* Location list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {/* All Locations option for admins */}
            {isOrgAdmin && (
              <button
                onClick={() => handleSelect("all")}
                className={`flex w-full items-center gap-2 px-3 py-2
                  hover:bg-dark-100 transition-colors
                  ${selectedLocationId === "all" ? "bg-gold-muted" : ""}`}
              >
                <Building2 className="w-4 h-4 text-gold shrink-0" />
                <span className="text-sm text-dark-600">All Locations</span>
              </button>
            )}

            {filteredLocations.map((loc) => (
              <button
                key={loc.storeLocationId}
                onClick={() => handleSelect(loc.storeLocationId)}
                className={`flex w-full items-center gap-2 px-3 py-2
                  hover:bg-dark-100 transition-colors duration-150
                  ${
                    loc.storeLocationId === selectedLocationId
                      ? "bg-gold-muted"
                      : ""
                  }`}
              >
                {/* Color stripe */}
                {loc.colorAccent && (
                  <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: loc.colorAccent }}
                  />
                )}

                {/* Avatar */}
                {loc.photoPath ? (
                  <img
                    src={loc.photoPath}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-dark-100 flex items-center justify-center shrink-0">
                    <MapPin className="w-3.5 h-3.5 text-dark-500" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm text-white truncate">
                    {loc.locationName}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full
                        ${CLASSIFICATION_COLORS[loc.classification] ?? "bg-dark-300"}
                        text-white font-medium uppercase tracking-wider`}
                    >
                      {CLASSIFICATION_LABELS[loc.classification] ??
                        loc.classification}
                    </span>
                    <LocationPulse storeLocationId={loc.storeLocationId} />
                  </div>
                </div>

                {/* Selected indicator */}
                {loc.storeLocationId === selectedLocationId && (
                  <div className="w-2 h-2 rounded-full bg-gold shadow-[0_0_6px_rgba(212,165,116,0.5)] shrink-0" />
                )}
              </button>
            ))}

            {filteredLocations.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-dark-500">
                No locations match your search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
