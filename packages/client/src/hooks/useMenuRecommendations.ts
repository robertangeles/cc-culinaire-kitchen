/**
 * @module hooks/useMenuRecommendations
 *
 * Fetch AI recommendations for a menu item.
 */

import { useState, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface MenuRecommendation {
  summary: string;
  actions: {
    type: string;
    description: string;
    impact?: string;
  }[];
  menuDescription?: string;
}

export function useMenuRecommendations() {
  const [recommendations, setRecommendations] = useState<MenuRecommendation | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = useCallback(async (menuItemId: string) => {
    setLoading(true);
    setRecommendations(null);
    try {
      const res = await fetch(`${API}/api/menu/items/${menuItemId}/recommendations`, { credentials: "include" });
      if (!res.ok) return;
      setRecommendations(await res.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const generateReplacement = useCallback(async (menuItemId: string) => {
    const res = await fetch(`${API}/api/menu/items/${menuItemId}/generate-replacement`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.json();
  }, []);

  return { recommendations, loading, fetchRecommendations, generateReplacement };
}
