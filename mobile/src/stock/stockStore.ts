/**
 * The stock screens' data: the location's dashboard, its item list and where items are kept, kept on the phone with the time of the
 * download so a no-signal start shows the last known figures and their age. Catalogue requests are queued commands; My requests is the
 * server's list (`/catalog-requests/mine`, with HQ's outcome) with the requests still on the phone laid over it.
 */

import type { LocationDashboard, LocationItem, StockAtLocation } from "@culinaire/shared/schemas/storeRoom";
import type { CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import type { CatalogRequest } from "@culinaire/shared/schemas/catalogRequest";
import type { StorageArea } from "@culinaire/shared/schemas/stockMovement";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { StockApi } from "./stockApi";
import { CATALOG_REQUEST, CATALOG_REQUEST_TYPES, type CatalogRequestCommand } from "./catalogRequestCommands";

/** On the phone: waiting, attention, discarded. On the server: sent (HQ has not decided, or a status this version does not know), approved, rejected. */
export type RequestState = "waiting" | "attention" | "sent" | "discarded" | "approved" | "rejected";
export type RequestRow = CatalogRequestCommand & { state: RequestState; entryId?: string; attentionMessage?: string; reviewNotes?: string | null };

export interface RequestForm {
  itemName: string;
  itemType: string | null;
  category: string | null;
  baseUnit: string | null;
  /** As typed; "" when not counted. */
  countedQty: string;
}

export interface StockSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing the last download because the server could not be reached. */
  offline: boolean;
  error?: string;
  dashboard: LocationDashboard | null;
  /** The items active here (with stock), then every other catalogue item, marked not active here and with no quantity. */
  items: LocationItem[];
  areas: StorageArea[];
  assignments: Record<string, string[]>;
  /** Epoch ms of the download shown, null before the first. */
  savedAt: number | null;
  requests: RequestRow[];
}

export interface StockStoreDeps {
  api: StockApi;
  /** The organisation's catalogue as the picker keeps it (`src/ingredients/catalogue.ts`): the location's list holds only items active there. */
  catalogue: { items(): Promise<CatalogueIngredient[]>; refresh(): Promise<boolean> };
  kv: KvStore;
  outbox: Outbox;
  userId: number;
  locationId: string;
  /** Holds `inventory:cost`: may see quantities. Hidden here too for a server from before `stock-levels` hid them. */
  canSeeQty: boolean;
  kick: () => void;
  now: () => number;
  newId: () => string;
}

type Saved = Pick<StockSnapshot, "dashboard" | "items" | "areas" | "assignments" | "savedAt">;

/** The server's limits (`RequestItemSchema`), checked so a request it would refuse is not queued. */
const MAX_NAME = 200;
const MAX_UNIT = 20;
const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

/** Catalogue items the location's list does not hold: not active here, quantity unknown here (absent, a dash). */
function withCatalogue(items: LocationItem[], catalogue: CatalogueIngredient[]): LocationItem[] {
  const here = new Set(items.map((i) => i.ingredientId));
  const others = catalogue.filter((c) => !here.has(c.ingredientId)).map((c): LocationItem => ({ ingredientId: c.ingredientId, ingredientName: c.ingredientName, ingredientCategory: c.ingredientCategory, itemType: c.itemType ?? "", baseUnit: c.baseUnit, parLevel: null, activeInd: false, lastCountedDttm: null, supplierName: null }));
  return [...items, ...others];
}

export function createStockStore({ api, catalogue, kv, outbox, userId, locationId, canSeeQty, kick, now, newId }: StockStoreDeps) {
  // Per account: what one person may see (quantities, value) is not another's.
  const savedKey = `stock.${userId}.${locationId}`;
  const requestsKey = `stock.requests.${userId}`;
  let snapshot: StockSnapshot = { phase: "loading", offline: false, dashboard: null, items: [], areas: [], assignments: {}, savedAt: null, requests: [] };
  const listeners = new Set<() => void>();
  const set = (next: Partial<StockSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** The person's requests, newest first; `discarded` marks one they threw away (the queue no longer lists it). */
  type RequestRecord = CatalogRequestCommand & { discarded?: true };
  const records = async () => JSON.parse((await kv.get(requestsKey)) ?? "[]") as RequestRecord[];
  const serverRequestsKey = `stock.requests.server.${userId}`;
  let serverRequests: CatalogRequest[] = [];

  async function rebuildRequests() {
    const entries = await outbox.entriesOfTypes(CATALOG_REQUEST_TYPES);
    const byId = new Map(entries.map((e) => [(e.command as CatalogRequestCommand).requestId, e]));
    const onServer = new Set(serverRequests.map((r) => r.requestId));
    // What only this phone knows: not sent yet, refused, discarded, or sent since the server's list was read.
    const local = (await records()).filter((r) => !onServer.has(r.requestId)).map(({ discarded, ...r }): RequestRow => {
      const e = byId.get(r.requestId);
      if (discarded) return { ...r, state: "discarded" };
      if (!e || e.status === "ACCEPTED") return { ...r, state: "sent" };
      if (e.status === "NEEDS_ATTENTION") return { ...r, state: "attention", entryId: e.id, attentionMessage: e.attention?.message };
      return { ...r, state: "waiting", entryId: e.id };
    });
    const server = serverRequests.map((r): RequestRow => ({ requestId: r.requestId, storeLocationId: r.storeLocationId, itemName: r.itemName, itemType: r.itemType || null, category: r.category, baseUnit: r.baseUnit, countedQty: r.countedQty, requestedAt: r.createdDttm, state: r.status === "APPROVED" ? "approved" : r.status === "REJECTED" ? "rejected" : "sent", reviewNotes: r.reviewNotes }));
    set({ requests: [...local, ...server].sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0)) });
  }

  const unsubscribe = outbox.subscribe(() => void rebuildRequests());

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispose: unsubscribe,

    /** Download everything the stock screens show, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      try {
        const [dashboard, items, areas, assignments] = await Promise.all([api.dashboard(locationId), api.items(locationId), api.areas(locationId), api.assignments(locationId), catalogue.refresh()]);
        const saved: Saved = { dashboard, items, areas, assignments, savedAt: now() };
        await kv.set(savedKey, JSON.stringify(saved));
        set({ phase: "ready", offline: false, error: undefined, ...saved, items: withCatalogue(items, await catalogue.items()) });
      } catch (err) {
        if (isOffline(err)) {
          const saved = JSON.parse((await kv.get(savedKey)) ?? "null") as Saved | null;
          set({ phase: "ready", offline: true, error: undefined, ...(saved ?? {}), items: withCatalogue(saved?.items ?? [], await catalogue.items()) });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await store.refreshRequests();
    },

    /** The server's list of this person's requests, or the last one read when it cannot be reached. */
    async refreshRequests(): Promise<void> {
      try {
        serverRequests = await api.myRequests();
        await kv.set(serverRequestsKey, JSON.stringify(serverRequests));
      } catch {
        serverRequests = JSON.parse((await kv.get(serverRequestsKey)) ?? "[]") as CatalogRequest[];
      }
      await rebuildRequests();
    },

    /** One item's stock at every location (managers; online only). Quantities this person may not see are left out. */
    async elsewhere(ingredientId: string): Promise<StockAtLocation[]> {
      const rows = await api.elsewhere(ingredientId);
      return canSeeQty ? rows : rows.map((r) => ({ ...r, currentQty: undefined }));
    },

    /** Ask for a new catalogue item: saved on the phone at once with a new id, sent when it can be. */
    async request(form: RequestForm): Promise<void> {
      const itemName = form.itemName.trim();
      if (!itemName) throw new Error("Give the item a name.");
      if (itemName.length > MAX_NAME) throw new Error("The name is too long.");
      const baseUnit = form.baseUnit?.trim() || null;
      if (baseUnit && baseUnit.length > MAX_UNIT) throw new Error("The unit is too long.");
      const typed = form.countedQty.trim();
      const countedQty = typed === "" ? null : Number(typed.replace(",", "."));
      if (countedQty !== null && (!Number.isFinite(countedQty) || countedQty < 0)) throw new Error("Enter how many you have: 0 or more.");
      const command: CatalogRequestCommand = { requestId: newId(), storeLocationId: locationId, itemName, itemType: form.itemType, category: form.category, baseUnit, countedQty, requestedAt: new Date(now()).toISOString() };
      await kv.set(requestsKey, JSON.stringify([command, ...(await records())]));
      await outbox.enqueueCommand(CATALOG_REQUEST, command);
      await rebuildRequests();
      kick();
    },

    async retry(entryId: string): Promise<void> {
      await outbox.retry(entryId);
      kick();
    },

    async discard(entryId: string): Promise<void> {
      const requestId = snapshot.requests.find((r) => r.entryId === entryId)?.requestId;
      await kv.set(requestsKey, JSON.stringify((await records()).map((r) => (r.requestId === requestId ? { ...r, discarded: true } : r))));
      await outbox.discard(entryId);
      await rebuildRequests();
    },
  };
  return store;
}

export type StockStore = ReturnType<typeof createStockStore>;
