/**
 * @module hooks/useStorageAreas
 * Hooks for storage area management and intra-location stock movements.
 * Areas organise the stocktake walk; movements reposition stock without
 * changing the on-hand total.
 */

import { useState, useEffect, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

/**
 * Storage areas are count sheets, not ledgers. There is still exactly one
 * on-hand number per item per venue; areas only organise the stocktake walk
 * and hold per-area pars.
 */
export interface StorageArea {
  storageAreaId: string;
  areaName: string;
  sortOrder: number;
  activeInd: boolean;
  /** How many items are on this area's sheet. */
  itemCount: number;
}

export interface AreaItem {
  ingredientId: string;
  ingredientName: string;
  /** THE kitchen unit — pars and counts are both in this unit. */
  baseUnit: string;
  /** Per-area par, in kitchen units. Null = no par set for this area. */
  areaParLevel: string | null;
  /** Shelf-to-sheet order — the sequence the counter walks the shelf. */
  sortOrder: number;
}

export interface AreaItemInput {
  ingredientId: string;
  areaParLevel?: number | null;
  sortOrder?: number;
}

export interface StockMovement {
  stockMovementId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  fromAreaName: string;
  toAreaName: string;
  userName: string;
  notes: string | null;
  movedAt: string;
}

// ─── useStorageAreas ──────────────────────────────────────────────

export function useStorageAreas(locationId: string | null) {
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/locations/${locationId}/storage-areas`, opts);
      if (res.ok) setAreas(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  /** Surface the server's sentence ("'Unassigned' is reserved…"), never a raw error. */
  const failWith = async (res: Response, fallback: string) => {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallback);
  };

  const create = useCallback(async (areaName: string, sortOrder?: number) => {
    if (!locationId) return;
    const res = await fetch(`${API}/locations/${locationId}/storage-areas`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ areaName, sortOrder }),
    });
    if (!res.ok) await failWith(res, "Couldn't create that area");
    await refresh();
  }, [locationId, refresh]);

  const update = useCallback(async (
    areaId: string,
    data: { areaName?: string; sortOrder?: number; activeInd?: boolean },
  ) => {
    const res = await fetch(`${API}/storage-areas/${areaId}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) await failWith(res, "Couldn't update that area");
    await refresh();
  }, [refresh]);

  /** Soft delete — count history that references the area survives. */
  const deactivate = useCallback(async (areaId: string) => {
    const res = await fetch(`${API}/storage-areas/${areaId}`, { ...opts, method: "DELETE" });
    if (!res.ok) await failWith(res, "Couldn't remove that area");
    await refresh();
  }, [refresh]);

  const getItems = useCallback(async (areaId: string): Promise<AreaItem[]> => {
    const res = await fetch(`${API}/storage-areas/${areaId}/items`, opts);
    if (!res.ok) return [];
    return res.json();
  }, []);

  /** Replaces the area's whole item set — the picker saves all of it at once. */
  const setItems = useCallback(async (areaId: string, items: AreaItemInput[]) => {
    const res = await fetch(`${API}/storage-areas/${areaId}/items`, {
      ...jsonOpts, method: "PUT", body: JSON.stringify({ items }),
    });
    if (!res.ok) await failWith(res, "Couldn't save the sheet");
    await refresh();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { areas, isLoading, refresh, create, update, deactivate, getItems, setItems };
}

// ─── useStockMovements ────────────────────────────────────────────

/**
 * Moving stock between areas has NO stock effect — the bottles are still on
 * site and still sellable. This is the sanctioned way to say "restocked the
 * bar" without deducting stock that will be deducted again at the sale.
 */
export function useStockMovements(locationId: string | null) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/locations/${locationId}/stock-movements`, opts);
      if (res.ok) setMovements(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  const recordMovement = useCallback(async (data: {
    ingredientId: string;
    fromStorageAreaId: string;
    toStorageAreaId: string;
    quantity: number;
    unit: string;
    notes?: string;
  }) => {
    if (!locationId) return;
    const res = await fetch(`${API}/locations/${locationId}/stock-movements`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Couldn't record that move");
    }
    await refresh();
  }, [locationId, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { movements, isLoading, refresh, recordMovement };
}
