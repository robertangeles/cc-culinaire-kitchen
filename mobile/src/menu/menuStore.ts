/**
 * The menu screens' data: the organisation's menu, its category targets and the items sold as they are, kept on the phone with the time of
 * the download so a no-signal start can still read them. Every write needs a connection and waits for the server; none is queued. A sale
 * that got no answer is kept with its key until the person sends it again (the server records a key once) or says to forget it.
 */

import type { MenuItem, MenuLine, Recommendation, Sale, SaleResult, SalesCsvPreview, SalesCsvReport, SellableConsumable, UnitsImport, YieldVariance } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { CsvFile, MenuApi, SaleAttempt, SaleTarget } from "./menuApi";
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
  /** The last 30 days of waste of each item's ingredients, in dollars, by item (`inventory:cost` holders only). */
  waste: Record<string, number>;
  /** An opened item's yield variance and plate cost, read with a signal only (`inventory:cost` holders only). */
  figures: Record<string, ItemFigures>;
}

export interface ItemFigures {
  variance?: YieldVariance;
  /** One serving's food cost at the location's average cost. */
  plateCost?: number;
  error?: string;
}

export interface MenuStoreDeps {
  api: MenuApi;
  kv: KvStore;
  userId: number;
  locationId: string;
  /** Holds `inventory:cost`. Costs are dropped here too for anyone else, for a server from before the menu routes left them out. */
  canSeeCost: boolean;
  now: () => number;
  newId: () => string;
}

type Saved = Pick<MenuSnapshot, "items" | "targets" | "consumables" | "savedAt"> & { waste?: Record<string, number> };

export const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");
const sentence = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

const wasteById = (rows: { menuItemId: string; wasteEstimate?: number | null }[]) =>
  Object.fromEntries(rows.flatMap((r) => (typeof r.wasteEstimate === "number" && r.wasteEstimate > 0 ? [[r.menuItemId, r.wasteEstimate]] : [])));

export function createMenuStore({ api, kv, userId, locationId, canSeeCost, now, newId }: MenuStoreDeps) {
  // Per account: what one person may see is not another's.
  const savedKey = `menu.${userId}`;
  const linesKey = (menuItemId: string) => `menu.lines.${userId}.${menuItemId}`;
  const saleKey = `menu.sale.${userId}`;
  let snapshot: MenuSnapshot = { phase: "loading", offline: false, items: [], targets: {}, consumables: [], savedAt: null, lines: {}, pendingSale: null, waste: {}, figures: {} };
  const listeners = new Set<() => void>();
  const set = (next: Partial<MenuSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const seen = (items: MenuItem[]) => (canSeeCost ? items : items.map(withoutCosts));
  const seenLines = (lines: MenuLine[]) => (canSeeCost ? lines : lines.map(lineWithoutCosts));

  let restoring: Promise<void> | null = null;
  /** A sale left unconfirmed when the app last closed. Read once: later reads would bring back one that has been confirmed since. */
  const restorePending = () => (restoring ??= kv.get(saleKey).then((kept) => set({ pendingSale: JSON.parse(kept ?? "null") as SaleAttempt | null })));

  async function setPending(pendingSale: SaleAttempt | null) {
    if (pendingSale) await kv.set(saleKey, JSON.stringify(pendingSale));
    else await kv.delete(saleKey);
    set({ pendingSale });
  }

  /** True from the first moment of a press until it is settled: a second press never mints a second key or drops the first. */
  let saleBusy = false;
  async function withSale<T>(act: () => Promise<T>): Promise<T> {
    if (saleBusy) throw new Error("A sale is being recorded. Wait for it to finish.");
    saleBusy = true;
    try {
      await restorePending();
      return await act();
    } finally {
      saleBusy = false;
    }
  }

  /** A refused first try was not recorded. A refused repeat says nothing about the try before it, so the key is kept. */
  async function send(attempt: SaleAttempt, first: boolean): Promise<SaleResult> {
    let result: SaleResult;
    try {
      result = await api.sell(attempt);
    } catch (err) {
      if (first && !mayHaveLanded(err)) await setPending(null);
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
        const [items, targets, consumables, waste] = await Promise.all([
          api.items(),
          api.targets().catch(() => snapshot.targets),
          api.consumables().catch(() => snapshot.consumables),
          // Without inventory:cost the server sends no dollars, so it is not asked.
          canSeeCost ? api.wasteImpact().then(wasteById, () => snapshot.waste) : {},
        ]);
        const saved: Saved = { items: seen(items), targets, consumables, savedAt: now(), waste };
        await kv.set(savedKey, JSON.stringify(saved));
        set({ phase: "ready", offline: false, error: undefined, ...saved });
      } catch (err) {
        if (isOffline(err)) {
          // Filtered again: it may have been kept while this person could see costs.
          const saved = JSON.parse((await kv.get(savedKey)) ?? "null") as Saved | null;
          set({ phase: "ready", offline: true, error: undefined, ...(saved && { ...saved, items: seen(saved.items), waste: canSeeCost ? (saved.waste ?? {}) : {} }) });
        } else set({ phase: "error", error: sentence(err) });
      }
    },

    /** One item's recipe lines, or the last ones read when there is no signal. */
    async loadLines(menuItemId: string): Promise<void> {
      try {
        const read = await api.lines(menuItemId);
        const lines = seenLines(read);
        await kv.set(linesKey(menuItemId), JSON.stringify(lines));
        set({ lines: { ...snapshot.lines, [menuItemId]: lines }, linesError: undefined });
      } catch (err) {
        const kept = isOffline(err) ? (JSON.parse((await kv.get(linesKey(menuItemId))) ?? "null") as MenuLine[] | null) : null;
        if (kept) set({ lines: { ...snapshot.lines, [menuItemId]: seenLines(kept) }, linesError: undefined });
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
    sell: (target: SaleTarget, qty: number): Promise<SaleResult> =>
      withSale(async () => {
        if (snapshot.pendingSale) throw new Error("The last sale is not confirmed yet. Send it again or forget it first.");
        // The server's limits (`fitsSaleQty`), so a sale it would refuse is not sent.
        if (!(qty > 0) || qty >= 1e7 || Number(qty.toFixed(3)) !== qty) throw new Error("Enter how many were sold, above zero and with up to 3 decimals.");
        const attempt: SaleAttempt = { key: newId(), target, qty, locationId };
        await setPending(attempt);
        return send(attempt, true);
      }),

    /** Send the unconfirmed sale again, the same one under the same key: the server never records it twice. */
    retrySale: (): Promise<SaleResult> =>
      withSale(async () => {
        if (!snapshot.pendingSale) throw new Error("There is no sale to send again.");
        return send(snapshot.pendingSale, false);
      }),

    forgetSale: (): Promise<void> => withSale(() => setPending(null)),

    sales: (): Promise<Sale[]> => api.sales(locationId),

    /** An item's yield variance and plate cost, for who may see costs; both are read again on every visit and never kept. */
    async loadFigures(menuItemId: string): Promise<void> {
      if (!canSeeCost) return;
      const [variance, plateCost] = await Promise.allSettled([api.yieldVariance(menuItemId), api.plateCost(menuItemId)]);
      const failed = [variance, plateCost].find((r) => r.status === "rejected")?.reason;
      const figures: ItemFigures = {
        variance: variance.status === "fulfilled" ? variance.value : undefined,
        plateCost: plateCost.status === "fulfilled" && typeof plateCost.value === "number" ? plateCost.value : undefined,
        error: failed === undefined ? undefined : isOffline(failed) ? "The yield variance and plate cost show when you're back online." : sentence(failed),
      };
      set({ figures: { ...snapshot.figures, [menuItemId]: figures } });
    },

    /** Price every item again and store its cost, mix and class, then read the menu again. */
    async recalculate(): Promise<void> {
      await api.recalculate();
      await store.refresh();
    },

    /** The model's advice on one item. Costs reach the model only for who may see them (the server's rule). */
    recommend: (menuItemId: string): Promise<Recommendation> => api.recommendations(menuItemId),

    /** The Recipe Lab request that asks for a replacement of this item. */
    replacement: (menuItemId: string): Promise<string> => api.replacement(menuItemId),

    /** Match a CSV of sales to the menu; nothing is recorded. */
    previewSales: (csv: CsvFile): Promise<SalesCsvPreview> => api.previewSales(csv),

    /** Record the matched rows as sales. Safe to send again: a row already recorded answers as already imported. */
    async commitSales(lines: SalesCsvPreview["matched"]): Promise<SalesCsvReport> {
      const report = await api.commitSales(lines);
      void store.refresh();
      return report;
    },

    /** Set each item's units sold from a CSV, then read the menu again (its mix and class change). */
    async importUnits(csv: CsvFile): Promise<UnitsImport> {
      const result = await api.importUnits(csv);
      await store.refresh();
      return result;
    },

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
