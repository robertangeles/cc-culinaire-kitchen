/**
 * @module components/location/LocationGate
 *
 * Wraps Kitchen Ops routes. If user has no location assignment
 * (and is not an org admin), shows NoLocationScreen instead of children.
 * Not an error state — a designed onboarding moment.
 */

import { useLocation } from "../../context/LocationContext";
import { NoLocationScreen } from "./NoLocationScreen";
import { Loader2 } from "lucide-react";

export function LocationGate({ children }: { children: React.ReactNode }) {
  const { hasLocationAccess, isResolved, isLoading } = useLocation();

  // Show the onboarding screen ONLY when we have a real answer. Until then the
  // honest state is "still working it out" — a spinner. Previously an unknown
  // answer looked identical to "no access", so a transient auth 401 on a cold
  // load flashed the organisation-key screen at users who had a location.
  if (isLoading || !isResolved) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px] bg-dark">
        <Loader2 className="w-6 h-6 text-gold animate-spin" />
      </div>
    );
  }

  if (!hasLocationAccess) {
    return <NoLocationScreen />;
  }

  return <>{children}</>;
}
