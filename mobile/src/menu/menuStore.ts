/**
 * The menu screens' data: the organisation's menu, its category targets and the items sold as they are, kept on the phone with the time of
 * the download so a no-signal start can still read them. Every write needs a connection and waits for the server; none is queued. A sale
 * that got no answer is kept with its key until the person sends it again (the server records a key once) or says to forget it.
 */

import type { MenuItem, MenuLine, Sale, SaleResult, SellableConsumable } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { MenuApi, SaleAttempt, SaleTarget } from "./menuApi";
import { mayHaveLanded } from "./menuEditor";
import { lineWithoutCosts, withoutCosts } from "./menuView";

export interface MenuSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing the last download because the server could not be reached. */
  offline: boolean;
  error?: string;
  items: MenuItem[];
  targets: Record<string, number>;
  consumables: SellableConsumable[];
  /** Epoch ms of the download shown, null before the first. */
  savedAt: number | null;
  /** The recipe lines of the items opened, by item. */
  lines: Record<string, MenuLine[]>;
  linesError?: string;
  /** A sale sent without an answer: it may or may not be recorded. */
  pendingSale: SaleAttempt | null;
}

export interface MenuStoreDeps {
  api: MenuApi;
  kv: KvStore;
  userId: number;
  locationId: string;
  /** Holds `inventory:cost`. The server sends menu costs to everyone with `menu:read`, so they are dropped here for anyone else. */
  canSeeCost: boolean;
  now: () => number;
  newId: () => string;
}

type Saved = Pick<MenuSnapshot, "items" | "targets" | "consumables" | "savedAt">;

export const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");
const sentence = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

export function createMenuStore({ api, kv, userId, locationId, canSeeCost, now, newId }: MenuStoreDeps) {
  // Per account: what one person may see is not another's.
  const savedKey = `menu.${userId}`;
  const linesKey = (menuItemId: string) => `menu.lines.${userId}.${menuItemId}`;
  const saleKey = `menu.sale.${userId}`;
  let snapshot: MenuSnapshot = { phase: "loading", offline: false, items: [], targets: {}, consumables: [], savedAt: null, lines: {}, pendingSale: null };
  const listeners = new Set<() => void>();
  const set = (next: Partial<MenuSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const seen = (items: MenuItem[]) => (canSeeCost ? items : items.map(withoutCosts));

  let restored = false;
  /** A sale left unconfirmed when the app last closed. Read once: later reads would bring back one that has been confirmed since. */
  async function restorePending() {
    if (restored) return;
    restored = true;
    set({ pendingSale: JSON.parse((await kv.get(saleKey)) ?? "null") as SaleAttempt | null });
  }

  async function setPending(pendingSale: SaleAttempt | null) {
    if (pendingSale) await kv.set(saleKey, JSON.stringify(pendingSale));
    else await kv.delete(saleKey);
    set({ pendingSale });
  }

  async function send(attempt: SaleAttempt): Promise<SaleResult> {
    let result: SaleResult;
    try {
      result = await api.sell(attempt);
    } catch (err) {
      if (!mayHaveLanded(err)) await setPending(null);
      throw err;
    }
    await setPending(null);
    void store.refresh();
    return canSeeCost ? result : { ...result, depleted: result.depleted.map(({ fohOnHand: _hidden, ...d }) => d) };
  }

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },

    /** Download the menu, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      await restorePending();
      try {
        const [items, targets, consumables] = await Promise.all([api.items(), api.targets().catch(() => snapshot.targets), api.consumables().catch(() => snapshot.consumables)]);
        const saved: Saved = { items: seen(items), targets, consumables, savedAt: now() };
        await kv.set(savedKey, JSON.stringify(saved));
        set({ phase: "ready", offline: false, error: undefined, ...saved });
      } catch (err) {
        if (isOffline(err)) set({ phase: "ready", offline: true, error: undefined, ...(JSON.parse((await kv.get(savedKey)) ?? "null") as Saved | null) });
        else set({ phase: "error", error: sentence(err) });
      }
    },

    /** One item's recipe lines, or the last ones read when there is no signal. */
    async loadLines(menuItemId: string): Promise<void> {
      try {
        const read = await api.lines(menuItemId);
        const lines = canSeeCost ? read : read.map(lineWithoutCosts);
        await kv.set(linesKey(menuItemId), JSON.stringify(lines));
        set({ lines: { ...snapshot.lines, [menuItemId]: lines }, linesError: undefined });
      } catch (err) {
        const kept = isOffline(err) ? (JSON.parse((await kv.get(linesKey(menuItemId))) ?? "null") as MenuLine[] | null) : null;
        if (kept) set({ lines: { ...snapshot.lines, [menuItemId]: kept }, linesError: undefined });
        else set({ linesError: isOffline(err) ? "The ingredients show when you're back online." : sentence(err) });
      }
    },

    /** Price a line at the catalogue's current cost again. */
    async refreshCost(menuItemId: string, rowId: number): Promise<void> {
      await api.refreshCost(menuItemId, rowId);
      await Promise.all([store.loadLines(menuItemId), store.refresh()]);
    },

    async remove(menuItemId: string): Promise<void> {
      try {
        await api.remove(menuItemId);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "not_found")) throw err;
      }
      await store.refresh();
    },

    async setTarget(category: string, typed: string): Promise<void> {
      const value = typed.trim().replace(",", ".");
      if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0 || Number(value) > 100) throw new Error("Enter a target above 0 and up to 100 percent.");
      await api.setTarget(category, value);
      set({ targets: { ...snapshot.targets, [category]: Number(value) } });
    },

    /** Record a sale here. Throws what the server said; after no answer at all the sale stays in `pendingSale`. */
    async sell(target: SaleTarget, qty: number): Promise<SaleResult> {
      await restorePending();
      if (snapshot.pendingSale) throw new Error("The last sale is not confirmed yet. Send it again or forget it first.");
      // The server's limits (`fitsSaleQty`), so a sale it would refuse is not sent.
      if (!(qty > 0) || qty >= 1e7 || Number(qty.toFixed(3)) !== qty) throw new Error("Enter how many were sold, above zero and with up to 3 decimals.");
      const attempt: SaleAttempt = { key: newId(), target, qty, locationId };
      await setPending(attempt);
      return send(attempt);
    },

    /** Send the unconfirmed sale again, the same one under the same key: the server never records it twice. */
    async retrySale(): Promise<SaleResult> {
      if (!snapshot.pendingSale) throw new Error("There is no sale to send again.");
      return send(snapshot.pendingSale);
    },

    forgetSale: () => setPending(null),

    sales: (): Promise<Sale[]> => api.sales(locationId),

    async voidSale(saleId: string): Promise<void> {
      try {
        await api.voidSale(saleId);
      } catch (err) {
        if (!(err instanceof ApiError && err.hasCode("INVALID_STATE"))) throw err; // already voided
      }
      await store.refresh();
    },
  };
  return store;
}

export type MenuStore = ReturnType<typeof createMenuStore>;
