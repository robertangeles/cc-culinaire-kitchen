/**
 * @module components/roster/VenueSelect
 *
 * Shared "All venues" / one-specific-venue picker, used by both the Add
 * Role form and the existing-role edit view in RolesManager.tsx — one
 * implementation instead of duplicating the dropdown + null-sentinel logic
 * in two places.
 */

import { useLocation } from "../../context/LocationContext.js";

export function VenueSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (storeLocationId: string | null) => void;
  disabled?: boolean;
}) {
  const { locations } = useLocation();

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 disabled:opacity-50"
    >
      <option value="">All venues</option>
      {locations.map((loc) => (
        <option key={loc.storeLocationId} value={loc.storeLocationId}>
          {loc.locationName}
        </option>
      ))}
    </select>
  );
}
