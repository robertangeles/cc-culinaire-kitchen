/**
 * @module components/location/LocationChip
 *
 * Compact "which kitchen am I in" anchor for the sidebar. Shows the active
 * location name and opens the existing Ctrl+L switcher on click. Hidden when
 * the user has no location access; static (non-interactive chrome) when there
 * is only one location to choose from.
 */

import { MapPin, ChevronsUpDown } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { OPEN_LOCATION_SWITCHER_EVENT } from "./LocationSwitcher.js";

export function LocationChip() {
  const { selectedLocation, locations, hasLocationAccess } = useLocation();

  // No location access → nothing to anchor.
  if (!hasLocationAccess) return null;

  const name = selectedLocation?.locationName ?? "Select a kitchen";
  const canSwitch = locations.length > 1;

  const content = (
    <>
      <MapPin className="size-3.5 text-[#D4A574] shrink-0" />
      <span className="flex-1 text-left truncate">{name}</span>
      {canSwitch && <ChevronsUpDown className="size-3.5 text-[#666666] shrink-0" />}
    </>
  );

  const baseClass =
    "flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-medium text-[#CCCCCC] bg-[#141414] border border-[#1E1E1E]";

  if (!canSwitch) {
    return <div className={`${baseClass} mx-3 mt-3`} style={{ width: "auto" }}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_LOCATION_SWITCHER_EVENT))}
      title="Switch kitchen (Ctrl+L)"
      className={`${baseClass} mx-3 mt-3 hover:border-[#D4A574]/40 hover:text-white transition-colors`}
      style={{ width: "auto" }}
    >
      {content}
    </button>
  );
}
