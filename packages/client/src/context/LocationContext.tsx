/**
 * @module context/LocationContext
 *
 * Provides store location context to the entire application.
 * Fetches assigned locations on auth, persists selection in DB,
 * and exposes switching + per-module memory.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";

export interface StoreLocation {
  storeLocationId: string;
  organisationId: number;
  locationName: string;
  classification: string;
  colorAccent: string | null;
  photoPath: string | null;
}

interface LocationContextValue {
  /** All locations the user has access to */
  locations: StoreLocation[];
  /** Currently selected location */
  selectedLocation: StoreLocation | null;
  /** Selected location ID */
  selectedLocationId: string | null;
  /** Whether user is an org admin (implicit all-location access) */
  isOrgAdmin: boolean;
  /** Whether user has at least one location */
  hasLocationAccess: boolean;
  /** Loading state */
  isLoading: boolean;
  /** Switch to a different location */
  switchLocation: (locationId: string, moduleKey?: string) => Promise<void>;
  /** Refresh location data from server */
  refreshLocations: () => Promise<void>;
  /** Previous location name for stale-switch toast */
  staleSwitchMessage: string | null;
  /** Clear the stale switch message */
  clearStaleSwitchMessage: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isGuest } = useAuth();

  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [hasLocationAccess, setHasLocationAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [staleSwitchMessage, setStaleSwitchMessage] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    if (!isAuthenticated || isGuest) {
      setLocations([]);
      setSelectedLocationId(null);
      setIsOrgAdmin(false);
      setHasLocationAccess(false);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/users/location-context", {
        credentials: "include",
      });
      if (!res.ok) {
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      setLocations(data.locations ?? []);
      setSelectedLocationId(data.selectedLocationId ?? null);
      setIsOrgAdmin(data.isOrgAdmin ?? false);
      setHasLocationAccess(data.hasLocationAccess ?? false);
    } catch {
      // Silent fail — non-critical for initial load
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isGuest]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const switchLocation = useCallback(
    async (locationId: string, moduleKey?: string) => {
      try {
        const res = await fetch("/api/users/selected-location", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeLocationId: locationId, moduleKey }),
        });
        if (res.ok) {
          setSelectedLocationId(locationId);
        }
      } catch {
        // Silent fail
      }
    },
    []
  );

  const selectedLocation =
    locations.find((l) => l.storeLocationId === selectedLocationId) ?? null;

  // Color accent CSS variable swap — subtle tint per location
  useEffect(() => {
    if (selectedLocation?.colorAccent) {
      document.documentElement.style.setProperty(
        "--location-accent",
        selectedLocation.colorAccent
      );
    } else {
      document.documentElement.style.removeProperty("--location-accent");
    }
  }, [selectedLocation?.colorAccent]);

  const clearStaleSwitchMessage = useCallback(() => {
    setStaleSwitchMessage(null);
  }, []);

  return (
    <LocationContext.Provider
      value={{
        locations,
        selectedLocation,
        selectedLocationId,
        isOrgAdmin,
        hasLocationAccess,
        isLoading,
        switchLocation,
        refreshLocations: fetchLocations,
        staleSwitchMessage,
        clearStaleSwitchMessage,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return ctx;
}
