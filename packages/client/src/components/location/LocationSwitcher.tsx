/**
 * @module components/location/LocationSwitcher
 *
 * Command palette overlay for quick location switching (Ctrl+L).
 * Glass morphism modal with search-as-you-type.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Search, X } from "lucide-react";
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

export function LocationSwitcher() {
  const {
    locations,
    selectedLocationId,
    switchLocation,
    hasLocationAccess,
  } = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Don't render if no locations
  if (!hasLocationAccess) return null;

  const filteredLocations = locations.filter((loc) =>
    loc.locationName.toLowerCase().includes(search.toLowerCase())
  );

  // Keyboard shortcut: Ctrl+L
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "l") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setSearch("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
        setSearch("");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation in list
  const handleKeyNav = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) =>
          Math.min(i + 1, filteredLocations.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filteredLocations[selectedIndex]) {
        e.preventDefault();
        handleSelect(filteredLocations[selectedIndex].storeLocationId);
      }
    },
    [filteredLocations, selectedIndex]
  );

  const handleSelect = async (locationId: string) => {
    await switchLocation(locationId);
    setIsOpen(false);
    setSearch("");
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]
        bg-black/70 backdrop-blur-xs animate-fade-in"
      onClick={() => {
        setIsOpen(false);
        setSearch("");
      }}
    >
      <div
        className="w-full max-w-md
          bg-dark-50 border border-dark-200
          rounded-xl shadow-[0_16px_50px_-12px_rgba(0,0,0,0.6)]
          overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + Search */}
        <div className="p-4 border-b border-dark-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium text-dark-500 uppercase tracking-wider">
              Switch Kitchen
            </h3>
            <div className="flex items-center gap-2">
              <kbd className="text-[10px] text-dark-500 bg-dark-100 px-1.5 py-0.5 rounded border border-dark-200">
                Ctrl+L
              </kbd>
              <button
                onClick={() => setIsOpen(false)}
                className="text-dark-500 hover:text-dark-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search locations..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyNav}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg
                bg-dark border border-dark-200 text-white
                placeholder:text-dark-500
                focus:outline-none focus:ring-2 focus:ring-gold-ring
                min-h-[44px]"
            />
          </div>
        </div>

        {/* Location list */}
        <div className="max-h-80 overflow-y-auto py-1">
          {filteredLocations.map((loc, idx) => (
            <button
              key={loc.storeLocationId}
              onClick={() => handleSelect(loc.storeLocationId)}
              className={`flex w-full items-center gap-3 px-4 py-3
                transition-colors duration-150
                ${
                  idx === selectedIndex
                    ? "bg-gold-muted"
                    : "hover:bg-dark-100"
                }
                ${
                  loc.storeLocationId === selectedLocationId
                    ? "border-l-2 border-gold"
                    : "border-l-2 border-transparent"
                }`}
            >
              {/* Color stripe */}
              {loc.colorAccent && (
                <div
                  className="w-1.5 h-10 rounded-full shrink-0"
                  style={{ backgroundColor: loc.colorAccent }}
                />
              )}

              {/* Avatar */}
              {loc.photoPath ? (
                <img
                  src={loc.photoPath}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-dark-100 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-dark-500" />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {loc.locationName}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
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

              {/* Active indicator */}
              {loc.storeLocationId === selectedLocationId && (
                <div className="w-2.5 h-2.5 rounded-full bg-gold shadow-[0_0_8px_rgba(212,165,116,0.5)] shrink-0" />
              )}
            </button>
          ))}

          {filteredLocations.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-dark-500">
              No locations match &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
