/**
 * @module hooks/useWorkforce
 *
 * Custom hooks for Workforce Optimisation (Phase 3): demand forecasting.
 */

import { useState, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/workforce`;
const opts = { credentials: "include" as const };

export interface StationDemand {
  station: string;
  recommendedHours: number;
  confidence: number;
  basedOnDays: number;
}

export interface WorkforceDemandResult {
  storeLocationId: string;
  forDate: string;
  targetCovers: number;
  stations: StationDemand[];
  inputsUsed: string[];
  inputsNotUsed: string[];
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export function useWorkforceDemand() {
  const [result, setResult] = useState<WorkforceDemandResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDemand = useCallback(async (storeLocationId: string, forDate: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/demand?storeLocationId=${storeLocationId}&forDate=${forDate}`, opts);
      if (!res.ok) throw await parseError(res, "Failed to load workforce demand");
      setResult(await res.json());
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Failed to load workforce demand");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { result, isLoading, error, fetchDemand };
}
