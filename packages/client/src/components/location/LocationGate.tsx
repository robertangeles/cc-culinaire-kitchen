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
  const { hasLocationAccess, isLoading } = useLocation();

  if (isLoading) {
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
