/**
 * @module components/location/NoLocationScreen
 *
 * Shown when a user has no location assignment and is not an org admin.
 * NOT an error — a warm, inviting onboarding screen with a store key
 * entry form. Fills the full Kitchen Ops content area.
 */

import { useState } from "react";
import { MapPin, Key, ArrowRight, Loader2, Building2, UserPlus } from "lucide-react";
import { Link } from "react-router";
import { useLocation } from "../../context/LocationContext";

export function NoLocationScreen() {
  const { refreshLocations } = useLocation();
  const [storeKey, setStoreKey] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleJoin = async () => {
    if (!storeKey.trim()) return;

    setIsJoining(true);
    setError(null);

    try {
      const res = await fetch("/api/store-locations/join", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeKey: storeKey.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to join location.");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        refreshLocations();
      }, 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header — matches Kitchen Ops page headers */}
        <div className="text-center mb-8">
          <MapPin className="size-10 mx-auto mb-3 text-[#D4A574]" />
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            Kitchen Operations
          </h1>
          <p className="text-[#999999] mt-2 max-w-lg mx-auto">
            You need to be assigned to a kitchen location to access this module.
          </p>
        </div>

        {/* Two-column layout: Store Key entry + Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Left: Store Key entry */}
          {!success ? (
            <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Key className="size-5 text-[#D4A574]" />
                <h2 className="text-base font-semibold text-[#E5E5E5]">
                  Join with Store Key
                </h2>
              </div>

              <p className="text-sm text-[#999999]">
                Enter the Store Key provided by your kitchen manager or admin.
              </p>

              <div className="space-y-3">
                <input
                  type="text"
                  value={storeKey}
                  onChange={(e) => {
                    setStoreKey(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  placeholder="KITCHEN-XXXXXXXXXXXX"
                  className="w-full px-4 py-2.5 text-sm rounded-lg
                    bg-[#0A0A0A] border border-[#2A2A2A] text-white
                    placeholder:text-[#666666] font-mono tracking-wider
                    focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50
                    min-h-[44px]"
                />
                <button
                  onClick={handleJoin}
                  disabled={isJoining || !storeKey.trim()}
                  className="w-full flex items-center justify-center gap-2
                    px-4 py-2.5 rounded-lg min-h-[44px]
                    bg-[#D4A574] hover:bg-[#C4956A]
                    text-[#0A0A0A] font-medium text-sm
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors"
                >
                  {isJoining ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Join Location
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>
          ) : (
            <div className="bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl p-6 flex flex-col items-center justify-center">
              <div className="text-[#D4A574] text-lg font-medium">
                You&apos;re in!
              </div>
              <p className="text-sm text-[#999999] mt-1">
                Loading your kitchen...
              </p>
            </div>
          )}

          {/* Right: Info + quick actions */}
          <div className="space-y-4">
            {/* Ask admin card */}
            <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="size-5 text-[#999999]" />
                <h3 className="text-sm font-semibold text-[#E5E5E5]">
                  Ask Your Admin
                </h3>
              </div>
              <p className="text-sm text-[#666666] leading-relaxed">
                Your organisation admin can assign you to a location directly
                from the Organisation settings. No key needed.
              </p>
            </div>

            {/* Admin? Create location */}
            <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="size-5 text-[#999999]" />
                <h3 className="text-sm font-semibold text-[#E5E5E5]">
                  Are You the Admin?
                </h3>
              </div>
              <p className="text-sm text-[#666666] leading-relaxed mb-3">
                Create your first store location in your organisation settings
                to unlock Kitchen Operations.
              </p>
              <Link
                to="/profile"
                className="inline-flex items-center gap-1.5 text-sm text-[#D4A574] hover:text-[#C4956A] font-medium transition-colors"
              >
                Go to Organisation Settings
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
