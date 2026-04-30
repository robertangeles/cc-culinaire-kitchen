/**
 * @module hooks/useAutoPoSuggestions
 *
 * Phase 4c: par-vs-stock reorder suggestions grouped by preferred supplier.
 */

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface AutoPoLine {
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  baseUnit: string;
  currentQty: number;
  parLevel: number;
  reorderQty: number | null;
  shortfall: number;
  suggestedQty: number;
  preferredUnitCost: number | null;
  estimatedCost: number | null;
}

export interface AutoPoSupplierBlock {
  supplierId: string | null;
  supplierName: string;
  lines: AutoPoLine[];
  estimatedTotal: number;
}

export interface AutoPoResult {
  storeLocationId: string;
  generatedAt: string;
  suppliers: AutoPoSupplierBlock[];
  totalLines: number;
  totalEstimatedCost: number;
}

export function useAutoPoSuggestions(storeLocationId: string | null | undefined) {
  const [result, setResult] = useState<AutoPoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    if (!storeLocationId) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/inventory/auto-po-suggestions?storeLocationId=${encodeURIComponent(storeLocationId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed to load suggestions (${res.status})`);
        return;
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err?.message ?? "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, [storeLocationId]);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  return { result, loading, error, refresh: fetchSuggestions };
}
