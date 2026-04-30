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
  /** Phase 3: denormalised allergen rollup from linked Catalog ingredients. */
  containsDairyInd?: boolean;
  containsGlutenInd?: boolean;
  containsNutsInd?: boolean;
  containsShellfishInd?: boolean;
  containsEggsInd?: boolean;
  isVegetarianInd?: boolean;
}

export interface MenuIngredient {
  id: number;
  menuItemId: string;
  /** Catalog FK — Phase 1 catalog spine. Null for legacy free-text rows. */
  ingredientId?: string | null;
  ingredientName: string;
  /** Narrative carried over from a recipe import or chef notes. */
  note?: string | null;
  quantity: string;
  unit: string;
  unitCost: string;
  yieldPct: string;
  lineCost: string;
  /** Phase 3: TRUE when the linked Catalog cost has changed since last refresh. */
  costStaleInd?: boolean;
  /** Phase 3: when the cost was marked stale. ISO string. */
  costStaleAt?: string | null;
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
    ingredientId?: string | null;
    ingredientName: string;
    note?: string | null;
    quantity: string;
    unit: string;
    unitCost?: string;
    yieldPct?: string;
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

  /**
   * Phase 3: refresh the cost on a Catalog-linked ingredient row from the
   * current Catalog preferred_unit_cost. Clears the stale-cost flag.
   */
  const refreshIngredientCost = useCallback(async (itemId: string, ingredientId: number) => {
    const res = await fetch(
      `${API}/api/menu/items/${itemId}/ingredients/${ingredientId}/refresh-cost`,
      { method: "POST", credentials: "include" },
    );
    if (!res.ok) {
      let msg = `Failed to refresh cost (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return (await res.json()) as MenuIngredient;
  }, []);

  const getIngredients = useCallback(async (itemId: string): Promise<MenuIngredient[]> => {
    const res = await fetch(`${API}/api/menu/items/${itemId}/ingredients`, { credentials: "include" });
    if (!res.ok) return [];
    return res.json();
  }, []);

  return {
    items, loading, refresh: fetchItems,
    createItem, updateItem, deleteItem,
    addIngredient, removeIngredient, refreshIngredientCost, getIngredients,
  };
}
