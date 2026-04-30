/**
 * @module hooks/useYieldVariance
 *
 * Phase 4a: bulk + single-dish yield variance fetchers.
 */

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export type VarianceStatus = "ok" | "no-period" | "thin-data" | "no-recipe";
export type VarianceThreshold = "good" | "warning" | "alert";

export interface YieldVariance {
  menuItemId: string;
  status: VarianceStatus;
  theoretical: number;
  actual: number;
  variance: number;
  variancePct: number;
  threshold: VarianceThreshold | null;
  unitsSold: number;
  consumptionLogCount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

/**
 * Bulk fetcher — used by the Menu Intelligence list view to populate the
 * variance pill column with a single round-trip. Returns a Map keyed by
 * menuItemId for O(1) lookup at render time.
 */
export function useYieldVariance() {
  const [byId, setById] = useState<Map<string, YieldVariance>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/menu/yield-variance`, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as YieldVariance[];
      setById(new Map(data.map((v) => [v.menuItemId, v])));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { byId, loading, refresh: fetchAll };
}
