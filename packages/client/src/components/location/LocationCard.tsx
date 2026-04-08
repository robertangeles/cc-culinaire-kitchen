/**
 * @module components/location/LocationCard
 *
 * Card for displaying a store location in admin views.
 * Shows classification badge, avatar, color accent, and action buttons.
 */

import { MapPin, Settings, Users, Key, Clock } from "lucide-react";

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

interface LocationCardProps {
  location: {
    storeLocationId: string;
    locationName: string;
    classification: string;
    colorAccent: string | null;
    photoPath: string | null;
    addressLine1?: string | null;
    suburb?: string | null;
    state?: string | null;
    storeKey?: string;
  };
  onEdit?: () => void;
  onManageStaff?: () => void;
  onManageHours?: () => void;
  onViewKey?: () => void;
}

export function LocationCard({
  location,
  onEdit,
  onManageStaff,
  onManageHours,
  onViewKey,
}: LocationCardProps) {
  return (
    <div
      className="bg-dark-50 border border-dark-200 rounded-xl overflow-hidden
        card-hover transition-all duration-300 group"
      style={{
        borderTopColor: location.colorAccent ?? undefined,
        borderTopWidth: location.colorAccent ? "3px" : undefined,
      }}
    >
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        {/* Avatar */}
        {location.photoPath ? (
          <img
            src={location.photoPath}
            alt=""
            className="w-12 h-12 rounded-lg object-cover shrink-0
              ring-1 ring-dark-200"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg bg-dark-100
              flex items-center justify-center shrink-0
              ring-1 ring-dark-200"
          >
            <MapPin className="w-5 h-5 text-dark-500" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">
            {location.locationName}
          </h3>

          {(location.addressLine1 || location.suburb) && (
            <p className="text-xs text-dark-500 truncate mt-0.5">
              {[location.addressLine1, location.suburb, location.state]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}

          <span
            className={`inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full
              ${CLASSIFICATION_COLORS[location.classification] ?? "bg-dark-300"}
              text-white font-medium uppercase tracking-wider`}
          >
            {CLASSIFICATION_LABELS[location.classification] ??
              location.classification}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 pb-3 flex gap-2">
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-[11px] text-dark-500
              hover:text-gold transition-colors px-2 py-1 rounded-md
              hover:bg-dark-100"
          >
            <Settings className="w-3 h-3" />
            Edit
          </button>
        )}
        {onManageStaff && (
          <button
            onClick={onManageStaff}
            className="flex items-center gap-1 text-[11px] text-dark-500
              hover:text-gold transition-colors px-2 py-1 rounded-md
              hover:bg-dark-100"
          >
            <Users className="w-3 h-3" />
            Staff
          </button>
        )}
        {onManageHours && (
          <button
            onClick={onManageHours}
            className="flex items-center gap-1 text-[11px] text-dark-500
              hover:text-gold transition-colors px-2 py-1 rounded-md
              hover:bg-dark-100"
          >
            <Clock className="w-3 h-3" />
            Hours
          </button>
        )}
        {onViewKey && (
          <button
            onClick={onViewKey}
            className="flex items-center gap-1 text-[11px] text-dark-500
              hover:text-gold transition-colors px-2 py-1 rounded-md
              hover:bg-dark-100"
          >
            <Key className="w-3 h-3" />
            Key
          </button>
        )}
      </div>
    </div>
  );
}
