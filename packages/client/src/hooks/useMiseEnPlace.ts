/**
 * @module hooks/useMiseEnPlace
 *
 * Phase 4b: forecast → station-grouped prep sheet.
 */

import { useState, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface MiseIngredientLine {
  ingredientId: string | null;
  ingredientName: string;
  category: string | null;
  unit: string;
  totalQty: number;
  dishes: string[];
  containsAllergens: string[];
}

export interface MiseStation {
  stationName: string;
  ingredients: MiseIngredientLine[];
}

export interface MiseEnPlaceResult {
  serviceDate: string;
  coversForecast: number;
  stations: MiseStation[];
  totalDishes: number;
  totalIngredientLines: number;
}

export function useMiseEnPlace() {
  const [result, setResult] = useState<MiseEnPlaceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSheet = useCallback(async (
    serviceDate: string,
    coversForecast: number,
    storeLocationId?: string | null,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        serviceDate,
        coversForecast: String(coversForecast),
      });
      if (storeLocationId) params.set("storeLocationId", storeLocationId);
      const res = await fetch(`${API}/api/menu/mise-en-place?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed to load mise en place (${res.status})`);
        return;
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err?.message ?? "Failed to load mise en place");
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, fetchSheet };
}
