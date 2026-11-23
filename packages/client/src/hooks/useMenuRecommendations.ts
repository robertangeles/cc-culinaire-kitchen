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

const TIMEOUT_MESSAGE = "That took too long. Please try again.";
const UNAVAILABLE_MESSAGE = "Recommendations are unavailable right now. Please try again shortly.";

export function useMenuRecommendations() {
  const [recommendations, setRecommendations] = useState<MenuRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async (menuItemId: string) => {
    setLoading(true);
    setRecommendations(null);
    setError(null);
    try {
      const res = await fetch(`${API}/api/menu/items/${menuItemId}/recommendations`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(res.status === 504 || body.code === "AI_TIMEOUT" ? TIMEOUT_MESSAGE : UNAVAILABLE_MESSAGE);
        return;
      }
      setRecommendations(await res.json());
    } catch {
      setError(UNAVAILABLE_MESSAGE);
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

  return { recommendations, loading, error, fetchRecommendations, generateReplacement };
}
