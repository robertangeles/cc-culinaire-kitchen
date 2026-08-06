/**
 * @module components/purchasing/SpendThresholdSettings
 *
 * Org default + per-location spend threshold overrides.
 */

import { useState, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useThresholds } from "../../hooks/useThresholds.js";
import { Settings, DollarSign, Loader2, Trash2, Plus } from "lucide-react";

export default function SpendThresholdSettings() {
  const { locations } = useLocation();
  const { data, isLoading, setOrgDefault, setLocationOverride, removeLocationOverride } = useThresholds();
  const [orgAmount, setOrgAmount] = useState("");
  const [locId, setLocId] = useState("");
  const [locAmount, setLocAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSetOrg = useCallback(async () => {
    const amount = Number(orgAmount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }
    setError(null);
    try {
      await setOrgDefault(amount);
      setOrgAmount("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [orgAmount, setOrgDefault]);

  const handleSetLocation = useCallback(async () => {
    if (!locId) { setError("Select a location"); return; }
    const amount = Number(locAmount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }
    setError(null);
    try {
      await setLocationOverride(locId, amount);
      setLocId("");
      setLocAmount("");
    } catch (err: any) {
      setError(err.message);
    }
  }, [locId, locAmount, setLocationOverride]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings className="size-5 text-gold" />
          Spend Thresholds
        </h2>
      </div>

      <p className="text-sm text-dark-600">
        POs below the threshold are sent directly to the supplier. POs at or above the threshold require HQ approval before sending.
      </p>

      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Org default */}
      <div className="rounded-xl bg-dark-50/80 backdrop-blur-sm border border-dark-200 p-4">
        <h3 className="text-sm font-medium text-white mb-3">Organisation Default</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-dark-500 mb-1">Current Threshold</label>
            <div className="text-lg font-semibold text-gold">
              {data?.orgDefault ? `$${data.orgDefault.toFixed(2)}` : "Not set (all POs go direct)"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-dark-500" />
              <input
                type="number"
                value={orgAmount}
                onChange={(e) => setOrgAmount(e.target.value)}
                placeholder="Amount"
                min="0"
                step="10"
                className="w-32 pl-8 pr-3 py-2 rounded-lg text-sm bg-dark text-white
                  border border-dark-200 focus:border-gold/40 outline-none placeholder:text-[#555]"
              />
            </div>
            <button
              onClick={handleSetOrg}
              className="px-4 py-2 rounded-lg text-sm font-medium
                bg-gradient-to-r from-gold to-gold-hover text-dark
                hover:shadow-[0_0_12px_rgba(212,165,116,0.3)] transition-all"
            >
              Update
            </button>
          </div>
        </div>
      </div>

      {/* Location overrides */}
      <div className="rounded-xl bg-dark-50/80 backdrop-blur-sm border border-dark-200 p-4">
        <h3 className="text-sm font-medium text-white mb-3">Location Overrides</h3>
        <p className="text-xs text-dark-500 mb-3">
          Override the org default for specific locations. A commissary with higher volume gets a higher threshold.
        </p>

        {data?.locationOverrides && data.locationOverrides.length > 0 ? (
          <div className="space-y-2 mb-4">
            {data.locationOverrides.map((o) => {
              const loc = locations.find((l) => l.storeLocationId === o.storeLocationId);
              return (
                <div key={o.thresholdId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark/50 border border-[#1A1A1A]">
                  <span className="text-sm text-white">{loc?.locationName ?? "Unknown"}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gold">${o.thresholdAmount.toFixed(2)}</span>
                    <button
                      onClick={() => o.storeLocationId && removeLocationOverride(o.storeLocationId)}
                      className="p-1 rounded text-dark-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-dark-500 mb-4">No location overrides — all locations use the org default.</p>
        )}

        {/* Add override */}
        <div className="flex items-center gap-2 pt-3 border-t border-[#1A1A1A]">
          <select
            value={locId}
            onChange={(e) => setLocId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-dark text-white
              border border-dark-200 focus:border-gold/40 outline-none"
          >
            <option value="">Select location...</option>
            {locations.map((l) => (
              <option key={l.storeLocationId} value={l.storeLocationId}>{l.locationName}</option>
            ))}
          </select>
          <div className="relative">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-dark-500" />
            <input
              type="number"
              value={locAmount}
              onChange={(e) => setLocAmount(e.target.value)}
              placeholder="Amount"
              min="0"
              step="10"
              className="w-28 pl-8 pr-3 py-2 rounded-lg text-sm bg-dark text-white
                border border-dark-200 focus:border-gold/40 outline-none placeholder:text-[#555]"
            />
          </div>
          <button
            onClick={handleSetLocation}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium
              bg-dark-100 text-gold border border-gold/20
              hover:border-gold/40 transition-all"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
