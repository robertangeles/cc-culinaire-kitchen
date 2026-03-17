/**
 * @module hooks/useMenuAnalysis
 *
 * Fetch menu analysis data (matrix, stats, classifications).
 */

import { useState, useEffect, useCallback } from "react";
import type { MenuItem } from "./useMenuItems.js";

const API = import.meta.env.VITE_API_URL ?? "";

export interface MenuAnalysis {
  totalItems: number;
  stars: number;
  plowhorses: number;
  puzzles: number;
  dogs: number;
  unclassified: number;
  avgFoodCostPct: string;
  avgContributionMargin: string;
  totalRevenue: string;
  totalFoodCost: string;
  overallFoodCostPct: string;
  items: MenuItem[];
}

export function useMenuAnalysis(category?: string) {
  const [analysis, setAnalysis] = useState<MenuAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const params = category ? `?category=${encodeURIComponent(category)}` : "";
      const res = await fetch(`${API}/api/menu/analysis${params}`, { credentials: "include" });
      if (!res.ok) return;
      setAnalysis(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { fetchAnalysis(); }, [fetchAnalysis]);

  const recalculate = useCallback(async () => {
    await fetch(`${API}/api/menu/analysis/recalculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ category }),
    });
    await fetchAnalysis();
  }, [category, fetchAnalysis]);

  return { analysis, loading, refresh: fetchAnalysis, recalculate };
}
