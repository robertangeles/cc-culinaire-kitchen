/**
 * @module components/location/LocationSetup
 *
 * First-location creation screen shown during org onboarding.
 * Forced after org creation — the platform isn't usable until
 * at least one location (HQ) is created.
 */

import { useState } from "react";
import {
  Building2,
  Palette,
  ArrowRight,
  Loader2,
  Sparkles,
  MapPin,
} from "lucide-react";
import { useLocation } from "../../context/LocationContext";

const COLOR_PALETTE = [
  "#FF6B35",
  "#FFD700",
  "#4ECDC4",
  "#5B8DEF",
  "#A855F7",
  "#F43F5E",
  "#10B981",
  "#F59E0B",
];

interface LocationSetupProps {
  organisationId: number;
  onComplete: () => void;
}

export function LocationSetup({
  organisationId,
  onComplete,
}: LocationSetupProps) {
  const { refreshLocations } = useLocation();

  const [locationName, setLocationName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [postcode, setPostcode] = useState("");
  const [colorAccent, setColorAccent] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/store-locations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId,
          locationName: locationName.trim(),
          classification: "hq",
          addressLine1: addressLine1 || undefined,
          addressLine2: addressLine2 || undefined,
          suburb: suburb || undefined,
          state: state || undefined,
          country: country || undefined,
          postcode: postcode || undefined,
          colorAccent: colorAccent || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to create location.");
        return;
      }

      setShowCelebration(true);
      await refreshLocations();

      setTimeout(() => {
        onComplete();
      }, 2500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showCelebration) {
    return (
      <div className="flex items-center justify-center min-h-[500px] p-8 bg-dark">
        <div className="text-center space-y-4 animate-bounce-in">
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-2xl
                bg-gold-muted border border-gold/20
                flex items-center justify-center
                shadow-[0_0_40px_rgba(212,165,116,0.2)]"
            >
              <Sparkles className="w-10 h-10 text-gold" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gold tracking-tight">
            Your first kitchen is set up!
          </h2>
          <p className="text-sm text-dark-600">
            Welcome to Kitchen Operations. Let&apos;s get cooking.
          </p>
        </div>
      </div>
    );
  }

  const inputClass = `w-full px-3 py-2 text-sm rounded-lg
    bg-dark border border-dark-200 text-white
    placeholder:text-dark-500
    focus:outline-none focus:ring-2 focus:ring-gold-ring
    min-h-[44px]`;

  return (
    <div className="max-w-lg mx-auto p-8 space-y-6 bg-dark">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div
            className="w-14 h-14 rounded-xl
              bg-gold-muted border border-gold/20
              flex items-center justify-center
              shadow-[0_0_20px_rgba(212,165,116,0.15)]"
          >
            <Building2 className="w-7 h-7 text-gold" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-gold tracking-tight">
          Create Your First Kitchen
        </h2>
        <p className="text-sm text-dark-600">
          Set up your headquarters to unlock Kitchen Operations.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-dark-50 border border-dark-200 rounded-xl p-5 space-y-4">
          {/* Location name */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-dark-600 mb-1.5">
              <MapPin className="w-3 h-3" /> Kitchen Name *
            </label>
            <input
              type="text"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="e.g. Main Kitchen, Downtown Branch"
              className={inputClass}
              required
            />
          </div>

          {/* Address */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-dark-600 mb-1 block">Address Line 1</label>
              <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-dark-600 mb-1 block">Address Line 2</label>
              <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-dark-600 mb-1 block">Suburb / City</label>
              <input type="text" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-dark-600 mb-1 block">State / Region</label>
              <input type="text" value={state} onChange={(e) => setState(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-dark-600 mb-1 block">Country</label>
              <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-dark-600 mb-1 block">Postcode</label>
              <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Color accent */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-dark-600 mb-2">
              <Palette className="w-3 h-3" /> Kitchen Color (optional)
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setColorAccent(colorAccent === color ? null : color)}
                  className={`w-8 h-8 rounded-lg transition-all duration-200
                    hover:scale-110
                    ${
                      colorAccent === color
                        ? "ring-2 ring-white/40 scale-110"
                        : "ring-1 ring-dark-200"
                    }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !locationName.trim()}
          className="w-full flex items-center justify-center gap-2
            px-4 py-3 rounded-xl min-h-[44px]
            bg-gold hover:bg-gold-hover
            text-dark font-semibold text-sm
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              Set Up Kitchen
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
