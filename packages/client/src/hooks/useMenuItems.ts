/**
 * @module hooks/useMenuItems
 *
 * CRUD for menu items + ingredients.
 */

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface MenuItem {
  menuItemId: string;
  userId: number;
  name: string;
  category: string;
  sellingPrice: number;
  foodCost: number;
  foodCostPct: number;
  contributionMargin: number;
  unitsSold: number;
  menuMixPct: number;
  classification: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface MenuIngredient {
  id: number;
  menuItemId: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  unitCost: string;
  yieldPct: string;
  lineCost: string;
}

export function useMenuItems(category?: string) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = category ? `?category=${encodeURIComponent(category)}` : "";
      const res = await fetch(`${API}/api/menu/items${params}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.map((i: any) => ({
        ...i,
        sellingPrice: parseFloat(i.sellingPrice ?? "0"),
        foodCost: parseFloat(i.foodCost ?? "0"),
        foodCostPct: parseFloat(i.foodCostPct ?? "0"),
        contributionMargin: parseFloat(i.contributionMargin ?? "0"),
        menuMixPct: parseFloat(i.menuMixPct ?? "0"),
      })));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const createItem = useCallback(async (data: { name: string; category: string; sellingPrice: string }): Promise<MenuItem> => {
    const res = await fetch(`${API}/api/menu/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = `Failed to create item (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch { /* not JSON */ }
      throw new Error(msg);
    }
    const created = await res.json();
    await fetchItems();
    return created as MenuItem;
  }, [fetchItems]);

  const updateItem = useCallback(async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`${API}/api/menu/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update item");
    await fetchItems();
  }, [fetchItems]);

  const deleteItem = useCallback(async (id: string) => {
    await fetch(`${API}/api/menu/items/${id}`, { method: "DELETE", credentials: "include" });
    await fetchItems();
  }, [fetchItems]);

  const addIngredient = useCallback(async (itemId: string, data: {
    ingredientName: string; quantity: string; unit: string; unitCost: string; yieldPct?: string;
  }) => {
    const res = await fetch(`${API}/api/menu/items/${itemId}/ingredients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let msg = `Failed to add ingredient (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = `${body.error} — "${data.ingredientName}"`;
      } catch { /* not JSON */ }
      throw new Error(msg);
    }
  }, []);

  const removeIngredient = useCallback(async (itemId: string, ingredientId: number) => {
    await fetch(`${API}/api/menu/items/${itemId}/ingredients/${ingredientId}`, {
      method: "DELETE", credentials: "include",
    });
  }, []);

  const getIngredients = useCallback(async (itemId: string): Promise<MenuIngredient[]> => {
    const res = await fetch(`${API}/api/menu/items/${itemId}/ingredients`, { credentials: "include" });
    if (!res.ok) return [];
    return res.json();
  }, []);

  return { items, loading, refresh: fetchItems, createItem, updateItem, deleteItem, addIngredient, removeIngredient, getIngredients };
}
