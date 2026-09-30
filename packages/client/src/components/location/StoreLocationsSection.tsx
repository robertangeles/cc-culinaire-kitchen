/**
 * @module components/location/StoreLocationsSection
 *
 * Admin section in ProfilePage Organisation tab for managing store locations.
 * Delegates create-form logic to LocationCreateForm and card logic to LocationCard.
 */

import { useState, useEffect } from "react";
import { MapPin, Plus, Loader2, AlertCircle } from "lucide-react";
import { useLocation } from "../../context/LocationContext";
import { LocationCreateForm } from "./LocationCreateForm";
import { LocationCard } from "./LocationCard";
import type { StoreLocationFull } from "./storeLocationTypes.js";

export function StoreLocationsSection({ orgId }: { orgId: number }) {
  const { refreshLocations } = useLocation();
  const [locations, setLocations] = useState<StoreLocationFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function fetchLocations() {
    setError("");
    try {
      const res = await fetch("/api/store-locations/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      const data = await res.json();
      setLocations(data.locations ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLocations();
  }, [orgId]);

  async function refreshAll() {
    await fetchLocations();
    await refreshLocations();
  }

  function handleExpand(locationId: string) {
    setExpandedId((prev) => (prev === locationId ? null : locationId));
  }

  return (
    <div className="border-t border-dark-200 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-dark-600" />
          <h3 className="text-sm font-semibold text-[#E5E5E5]">
            Store Locations ({locations.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg
            bg-gold text-dark hover:bg-gold-hover transition-colors min-h-[32px]"
        >
          <Plus className="size-3" />
          Add Location
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          <AlertCircle className="size-4 flex-shrink-0" /> {error}
        </div>
      )}

      {showCreate && (
        <LocationCreateForm
          orgId={orgId}
          locations={locations}
          onClose={() => setShowCreate(false)}
          onRefresh={refreshAll}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-dark-500" />
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-6">
          <MapPin className="size-8 mx-auto text-dark-500 mb-2" />
          <p className="text-sm text-dark-500">No store locations yet.</p>
          <p className="text-xs text-dark-500 mt-1">Click &ldquo;Add Location&rdquo; to create your first kitchen.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <LocationCard
              key={loc.storeLocationId}
              loc={loc}
              orgId={orgId}
              isExpanded={expandedId === loc.storeLocationId}
              onExpand={() => handleExpand(loc.storeLocationId)}
              onRefresh={refreshAll}
            />
          ))}
        </div>
      )}
    </div>
  );
}
