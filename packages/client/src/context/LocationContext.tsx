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
  /** True only once a location-context response has actually been received. */
  isResolved: boolean;
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
  const { isAuthenticated, isGuest, isLoading: isAuthLoading } = useAuth();

  const [locations, setLocations] = useState<StoreLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [hasLocationAccess, setHasLocationAccess] = useState(false);
  /**
   * Have we actually received an answer about location access?
   *
   * `hasLocationAccess === false` used to mean two different things: "we asked
   * and you have none" and "we never got an answer". LocationGate could not tell
   * them apart, so any moment where the answer was unknown rendered the
   * "Run the Kitchen — enter your organisation key" onboarding screen at users
   * who already had a location. That happens routinely: /api/auth/me 401s
   * transiently on a cold load before succeeding, and the location request can
   * fail outright. Only a successful response sets this true.
   */
  const [isResolved, setIsResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [staleSwitchMessage, setStaleSwitchMessage] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    // Auth still resolving — we do NOT yet know whether this user has a
    // location. Stay in the loading state instead of answering "no access".
    // Without this, a full page load briefly reported hasLocationAccess=false
    // with isLoading=false, so LocationGate flashed the "Run the Kitchen"
    // onboarding screen (asking for an organisation key) at users who already
    // had a location. It corrected itself a moment later once auth resolved,
    // which made it read as a random, annoying splash.
    if (isAuthLoading) {
      setIsLoading(true);
      return;
    }
    if (!isAuthenticated || isGuest) {
      setLocations([]);
      setSelectedLocationId(null);
      setIsOrgAdmin(false);
      setHasLocationAccess(false);
      // Resolved on purpose: auth has FINISHED (checked above) and this user is
      // not signed in, so "no location access" is a real answer, not an unknown.
      // Without this the gate would spin forever when auth bootstrap ends with
      // no user — trading a wrong screen for a hung one.
      setIsResolved(true);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/users/location-context", {
        credentials: "include",
      });
      if (!res.ok) {
        // Deliberately NOT resolved: a 401 here is usually a cold-start race,
        // not a real answer. Leaving isResolved false keeps the gate on its
        // spinner instead of falsely claiming the user has no location.
        setIsLoading(false);
        return;
      }
      const data = await res.json();
      setLocations(data.locations ?? []);
      setSelectedLocationId(data.selectedLocationId ?? null);
      setIsOrgAdmin(data.isOrgAdmin ?? false);
      setHasLocationAccess(data.hasLocationAccess ?? false);
      setIsResolved(true);
    } catch {
      // Silent fail — non-critical for initial load
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, isGuest, isAuthLoading]);

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
        isResolved,
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
