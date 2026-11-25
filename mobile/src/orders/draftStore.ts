/**
 * An order being written at this location, or a saved draft being changed (`editing`). A new order is kept on the phone as it is typed, so
 * leaving the screen or closing the app loses nothing; saving either to the server needs a connection. A save repeated after a lost reply
 * never makes a second order: create carries an id made on the phone, and an edit replaces the same draft again.
 */

import type { OrderGuide, OrderGuideItem, OrderItem, SupplierOption } from "@culinaire/shared/schemas/purchasing";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import { createIngredientSource, type IngredientSource } from "../ingredients/source";
import { draftFromOrder, draftProblem, emptyDraft, lineFromGuide, lineFromItem, toBody, type Draft, type DraftLine } from "./draft";
import type { OrdersApi } from "./ordersApi";
import { loadMessage, orderFailure } from "./orderView";

export interface DraftSnapshot {
  phase: "loading" | "ready" | "error";
  error: string | null;
  draft: Draft;
  suppliers: SupplierOption[];
  guides: OrderGuide[];
  items: OrderItem[];
  /** The chosen guide's lines, for their par and minimum. */
  guideItems: OrderGuideItem[];
  saving: boolean;
  saveError: string | null;
}

/** Saved: `notSubmitted` is why it is still a draft when it was meant to be submitted as well. */
export interface Saved {
  poId: string;
  notSubmitted: string | null;
}

export interface DraftDeps {
  api: OrdersApi;
  kv: KvStore;
  key: string;
  locationId: string;
  newId: () => string;
  /** The server opens order guides to `purchasing:draft`. */
  guidesAllowed: boolean;
  /** The saved draft to change; a new order without it. */
  editing?: string;
}

export function createDraftStore({ api, kv, key, locationId, newId, guidesAllowed, editing }: DraftDeps) {
  let snapshot: DraftSnapshot = { phase: "loading", error: null, draft: emptyDraft, suppliers: [], guides: [], items: [], guideItems: [], saving: false, saveError: null };
  const listeners = new Set<() => void>();
  /** The items the chosen supplier sells; null while unknown. */
  let supplierItems: Set<string> | null = null;
  /** An order being changed keeps its own location, which may not be the one the person works at now. */
  let location = locationId;
  let supplierTicket = 0;
  let guideTicket = 0;
  let restored: Promise<void> | null = null;
  // One write after another, so the last change typed is the one kept.
  let writes: Promise<void> = Promise.resolve();

  const set = (next: Partial<DraftSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  function setDraft(next: Draft) {
    set({ draft: next });
    if (editing) return; // the server has it
    const text = JSON.stringify(next);
    writes = writes.then(() => kv.set(key, text)).catch(() => undefined);
  }
  const update = (change: Partial<Draft>) => setDraft({ ...snapshot.draft, ...change });

  const restore = () =>
    (restored ??= (async () => {
      try {
        const doc = JSON.parse((await kv.get(key)) ?? "null") as Partial<Draft> | null;
        if (doc && Array.isArray(doc.lines)) set({ draft: { ...emptyDraft, ...doc } });
      } catch {
        // A damaged note is an empty order.
      }
    })());

  async function loadSupplierItems(supplierId: string | null) {
    const ticket = ++supplierTicket;
    supplierItems = null;
    if (!supplierId) return;
    try {
      const ids = await api.supplierItemIds(supplierId);
      if (ticket === supplierTicket) supplierItems = new Set(ids);
    } catch {
      // Unknown: every item is offered.
    }
  }

  async function loadGuide(guideId: string): Promise<OrderGuideItem[] | null> {
    const ticket = ++guideTicket;
    const items = await api.guideItems(guideId, location);
    if (ticket !== guideTicket) return null;
    set({ guideItems: items });
    return items;
  }

  /** The saved order's id. Throws an ApiError. */
  async function write(): Promise<string> {
    const body = toBody(snapshot.draft, location);
    if (editing) return (await api.update(editing, body)).poId;
    const poId = snapshot.draft.poId ?? newId();
    // Kept before it is sent, so a save repeated after a lost reply, even after a restart, carries the same id.
    if (!snapshot.draft.poId) update({ poId });
    await writes;
    try {
      return (await api.create({ ...body, poId })).poId;
    } catch (err) {
      // The id already made an order with another body: a save whose reply was lost did land, and the order was changed since. Bring it up to date.
      if (err instanceof ApiError && err.hasCode("CONFLICT")) return (await api.update(poId, body)).poId;
      throw err;
    }
  }

  const source: IngredientSource = createIngredientSource({
    catalogue: {
      items: async (): Promise<CatalogueIngredient[]> => {
        const added = new Set(snapshot.draft.lines.map((l) => l.ingredientId));
        // A supplier with no items linked to it yet would leave nothing to find: offer them all.
        const sold = supplierItems && supplierItems.size > 0 ? supplierItems : null;
        return snapshot.items
          .filter((i) => !added.has(i.ingredientId) && (!sold || sold.has(i.ingredientId)))
          .map((i) => ({ ingredientId: i.ingredientId, ingredientName: i.ingredientName, baseUnit: i.purchaseUnit || i.baseUnit, ingredientCategory: "" }));
      },
    },
    recents: { list: async () => [], remember: async () => undefined },
  });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    source,
    /** The unfinished order on this phone, for the list to offer. */
    restore,

    async load(): Promise<void> {
      if (snapshot.phase === "error") set({ phase: "loading", error: null });
      try {
        if (!editing) await restore();
        else if (snapshot.phase !== "ready") {
          const order = await api.detail(editing);
          if (order.status !== "DRAFT") return set({ phase: "error", error: NOT_A_DRAFT });
          location = order.storeLocationId;
          set({ draft: draftFromOrder(order) });
        }
        const [suppliers, items, guides] = await Promise.all([api.suppliers(), api.items(location), guidesAllowed ? api.guides(location).catch(() => []) : []]);
        set({ phase: "ready", error: null, suppliers: [...suppliers].sort((a, b) => a.supplierName.localeCompare(b.supplierName)), items, guides });
      } catch (err) {
        const offline = err instanceof ApiError && err.code === "network";
        set({ phase: "error", error: offline ? orderFailure(err, editing ? "Changing an order" : "Writing an order").message : loadMessage(err) });
        return;
      }
      void loadSupplierItems(snapshot.draft.supplierId);
      if (snapshot.draft.guideId) await loadGuide(snapshot.draft.guideId).catch(() => undefined);
    },

    update,
    chooseSupplier(s: SupplierOption) {
      update({ supplierId: s.supplierId, supplierName: s.supplierName });
      void loadSupplierItems(s.supplierId);
    },
    /** Fills the order from a guide, every quantity at par; what was on it is replaced. */
    async applyGuide(guide: OrderGuide): Promise<void> {
      set({ saveError: null });
      try {
        const items = await loadGuide(guide.orderGuideId);
        if (!items) return;
        update({ guideId: guide.orderGuideId, supplierId: guide.supplierId, supplierName: guide.supplierName ?? "", lines: items.map(lineFromGuide) });
        void loadSupplierItems(guide.supplierId);
      } catch (err) {
        set({ saveError: loadMessage(err) });
      }
    },
    add(ingredientId: string) {
      const item = snapshot.items.find((i) => i.ingredientId === ingredientId);
      if (!item || snapshot.draft.lines.some((l) => l.ingredientId === ingredientId)) return;
      update({ lines: [...snapshot.draft.lines, lineFromItem(item)] });
    },
    setLine(line: DraftLine) {
      update({ lines: snapshot.draft.lines.map((l) => (l.ingredientId === line.ingredientId ? line : l)) });
    },
    removeLine(ingredientId: string) {
      update({ lines: snapshot.draft.lines.filter((l) => l.ingredientId !== ingredientId) });
    },
    discard() {
      set({ saveError: null, guideItems: [] });
      setDraft(emptyDraft);
    },

    /** Saves the order as a draft and, with `submit`, submits it. Null when it was not saved (`saveError` says why). */
    async save(submit: boolean): Promise<Saved | null> {
      if (snapshot.saving) return null;
      const problem = draftProblem(snapshot.draft);
      if (problem) {
        set({ saveError: problem });
        return null;
      }
      set({ saving: true, saveError: null });
      try {
        const poId = await write();
        // It is the server's now: whatever submitting does, saving again would make a second order.
        if (!editing) {
          setDraft(emptyDraft);
          set({ guideItems: [] });
        }
        if (!submit) return { poId, notSubmitted: null };
        try {
          await api.submit(poId);
          return { poId, notSubmitted: null };
        } catch (err) {
          return { poId, notSubmitted: `Saved, but not submitted. ${orderFailure(err, "Submitting an order").message}` };
        }
      } catch (err) {
        set({ saveError: saveMessage(err, editing !== undefined) });
        return null;
      } finally {
        set({ saving: false });
      }
    },
  };
}

export const NOT_A_DRAFT = "This order is no longer a draft, so it can't be changed.";

function saveMessage(err: unknown, editing: boolean): string {
  const f = orderFailure(err, "Saving an order");
  if (f.moved) return editing ? NOT_A_DRAFT : "This order was already saved and is no longer a draft. It is in Orders; discard this one to write another.";
  if (!f.unsure) return f.message;
  const said = f.message.replace(" Check the order before trying again.", "");
  return `${said} ${editing ? "It is safe to save again." : "Your order is kept on this phone, and it is safe to save again: it can't be made twice."}`;
}

export type DraftStore = ReturnType<typeof createDraftStore>;
