/**
 * @module hooks/useOrderGuides
 *
 * Purchasing P1: order guides are the primary PO-creation surface — a reusable
 * per-supplier list the operator works from each week, with quantities pre-filled
 * to par. The manual catalog builder is the fallback.
 *
 * Payload types come from @culinaire/shared so a server field rename breaks the
 * build here instead of silently rendering blank cells at runtime.
 */

import { useState, useEffect, useCallback } from "react";
import type { OrderGuideSummary, OrderGuideItemView } from "@culinaire/shared";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/inventory`;
const opts = { credentials: "include" as const };
const jsonOpts = {
  credentials: "include" as const,
  headers: { "Content-Type": "application/json" },
};

/** What the guide editor saves back — the server replaces the set wholesale. */
export interface OrderGuideItemInput {
  ingredientId: string;
  defaultOrderQty?: number | null;
  defaultPurchaseUnit?: string | null;
  sortOrder?: number;
}

/** Surface the server's plain-English message; never leak a raw status to the operator. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string })?.error ?? fallback;
}

/**
 * The guides available at a location — its own plus any org-wide ones. Feeds the
 * guide pills at the top of the ordering screen.
 */
export function useOrderGuides(storeLocationId: string | null | undefined) {
  const [guides, setGuides] = useState<OrderGuideSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!storeLocationId) {
      setGuides([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE}/locations/${encodeURIComponent(storeLocationId)}/order-guides`,
        opts,
      );
      if (!res.ok) {
        setError(await errorFrom(res, "Couldn't load your order guides"));
        return;
      }
      setGuides((await res.json()) as OrderGuideSummary[]);
    } catch {
      setError("Couldn't load your order guides");
    } finally {
      setLoading(false);
    }
  }, [storeLocationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createGuide = useCallback(
    async (data: { supplierId: string; name: string; orgWide?: boolean }) => {
      if (!storeLocationId) throw new Error("Pick a location first");
      const res = await fetch(
        `${BASE}/locations/${encodeURIComponent(storeLocationId)}/order-guides`,
        { ...jsonOpts, method: "POST", body: JSON.stringify(data) },
      );
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't create that guide"));
      const created = (await res.json()) as OrderGuideSummary;
      await refresh();
      return created;
    },
    [storeLocationId, refresh],
  );

  const updateGuide = useCallback(
    async (
      guideId: string,
      data: { name?: string; activeInd?: boolean; sortOrder?: number },
    ) => {
      const res = await fetch(`${BASE}/order-guides/${encodeURIComponent(guideId)}`, {
        ...jsonOpts,
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't update that guide"));
      await refresh();
    },
    [refresh],
  );

  const deleteGuide = useCallback(
    async (guideId: string) => {
      const res = await fetch(`${BASE}/order-guides/${encodeURIComponent(guideId)}`, {
        ...opts,
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't remove that guide"));
      await refresh();
    },
    [refresh],
  );

  return { guides, loading, error, refresh, createGuide, updateGuide, deleteGuide };
}

/**
 * One guide's lines, priced and par-filled against the active location:
 * on-hand, par, suggested order qty (par − on-hand), live cost, and the
 * supplier's minimum. This is the payload the ordering screen renders.
 */
export function useOrderGuideItems(
  guideId: string | null | undefined,
  storeLocationId: string | null | undefined,
) {
  const [items, setItems] = useState<OrderGuideItemView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!guideId || !storeLocationId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${BASE}/order-guides/${encodeURIComponent(guideId)}/items?locationId=${encodeURIComponent(storeLocationId)}`,
        opts,
      );
      if (!res.ok) {
        setError(await errorFrom(res, "Couldn't load this guide's items"));
        return;
      }
      setItems((await res.json()) as OrderGuideItemView[]);
    } catch {
      setError("Couldn't load this guide's items");
    } finally {
      setLoading(false);
    }
  }, [guideId, storeLocationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Replace the guide's item set wholesale (the editor saves the full list). */
  const saveItems = useCallback(
    async (next: OrderGuideItemInput[]) => {
      if (!guideId) throw new Error("No guide selected");
      const res = await fetch(`${BASE}/order-guides/${encodeURIComponent(guideId)}/items`, {
        ...jsonOpts,
        method: "PUT",
        body: JSON.stringify({ items: next }),
      });
      if (!res.ok) throw new Error(await errorFrom(res, "Couldn't save this guide's items"));
      await refresh();
    },
    [guideId, refresh],
  );

  return { items, loading, error, refresh, saveItems };
}
