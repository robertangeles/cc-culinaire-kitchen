/**
 * @module hooks/useThresholds
 *
 * Hook for spend threshold settings (org default + location overrides).
 */

import { useState, useEffect, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

export interface ThresholdData {
  orgDefault: number | null;
  locationOverrides: Array<{
    thresholdId: string;
    storeLocationId: string | null;
    thresholdAmount: number;
  }>;
}

export function useThresholds() {
  const [data, setData] = useState<ThresholdData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/thresholds`, opts);
      if (res.ok) setData(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setOrgDefault = useCallback(async (amount: number) => {
    const res = await fetch(`${API}/thresholds/org`, {
      ...jsonOpts, method: "PUT", body: JSON.stringify({ amount }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to set org threshold");
    }
    await refresh();
  }, [refresh]);

  const setLocationOverride = useCallback(async (storeLocationId: string, amount: number) => {
    const res = await fetch(`${API}/thresholds/location`, {
      ...jsonOpts, method: "PUT", body: JSON.stringify({ storeLocationId, amount }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to set location threshold");
    }
    await refresh();
  }, [refresh]);

  const removeLocationOverride = useCallback(async (storeLocationId: string) => {
    const res = await fetch(`${API}/thresholds/location/${storeLocationId}`, {
      ...opts, method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to remove location threshold");
    }
    await refresh();
  }, [refresh]);

  return {
    data,
    isLoading,
    refresh,
    setOrgDefault,
    setLocationOverride,
    removeLocationOverride,
  };
}
