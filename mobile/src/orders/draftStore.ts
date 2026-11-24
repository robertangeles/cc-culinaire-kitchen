/**
 * The order being written at this location. It is kept on the phone as it is typed, so leaving the screen or closing the app loses nothing;
 * saving it to the server needs a connection. A save whose answer was lost is looked for on the server before anything is sent again.
 */

import type { OrderGuide, OrderGuideItem, OrderItem, SupplierOption } from "@culinaire/shared/schemas/purchasing";
import type { KvStore } from "../storage/kv";
import type { CatalogueIngredient } from "@culinaire/shared/schemas/catalogue";
import { createIngredientSource, type IngredientSource } from "../ingredients/source";
import { draftProblem, emptyDraft, lineFromGuide, lineFromItem, toBody, type Draft, type DraftLine } from "./draft";
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
  userId: number;
  /** The server opens order guides to `purchasing:draft`. */
  guidesAllowed: boolean;
}

export function createDraftStore({ api, kv, key, locationId, userId, guidesAllowed }: DraftDeps) {
  let snapshot: DraftSnapshot = { phase: "loading", error: null, draft: emptyDraft, suppliers: [], guides: [], items: [], guideItems: [], saving: false, saveError: null };
  const listeners = new Set<() => void>();
  /** The items the chosen supplier sells; null while unknown. */
  let supplierItems: Set<string> | null = null;
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
    const items = await api.guideItems(guideId, locationId);
    if (ticket !== guideTicket) return null;
    set({ guideItems: items });
    return items;
  }

  /** The order a lost save left on the server, if it did: this person's draft for the supplier that was not there before. */
  async function landed(pending: NonNullable<Draft["pending"]>): Promise<string | null> {
    const sent = JSON.parse(pending.sent) as ReturnType<typeof toBody>;
    const drafts = await api.list(locationId, ["DRAFT"]);
    return drafts.find((o) => !pending.known.includes(o.poId) && o.createdByUserId === userId && o.supplierId === sent.supplierId && o.lineCount === sent.lines.length)?.poId ?? null;
  }

  /** The order's id on the server. Throws an ApiError, or an Error with a sentence for the person. */
  async function create(): Promise<string> {
    const body = toBody(snapshot.draft, locationId);
    const sent = JSON.stringify(body);
    const before = snapshot.draft.pending;
    if (before) {
      const poId = await landed(before);
      if (poId && before.sent === sent) return poId;
      update({ pending: null });
      if (poId) throw new Error("This order was saved before you changed it. The earlier version is in Orders as a draft: cancel it there, then save this one.");
    }
    const known = (await api.list(locationId, ["DRAFT"])).map((o) => o.poId);
    try {
      return (await api.create(body)).poId;
    } catch (err) {
      if (!orderFailure(err, "").unsure) throw err;
      update({ pending: { known, sent } });
      const poId = await landed({ known, sent }).catch(() => null);
      if (poId) return poId;
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
      await restore();
      try {
        const [suppliers, items, guides] = await Promise.all([api.suppliers(), api.items(locationId), guidesAllowed ? api.guides(locationId).catch(() => []) : []]);
        set({ phase: "ready", error: null, suppliers: [...suppliers].sort((a, b) => a.supplierName.localeCompare(b.supplierName)), items, guides });
      } catch (err) {
        set({ phase: "error", error: loadMessage(err) });
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
        const poId = await create();
        // It is the server's now: whatever submitting does, saving again would make a second order.
        setDraft(emptyDraft);
        set({ guideItems: [] });
        if (!submit) return { poId, notSubmitted: null };
        try {
          await api.submit(poId);
          return { poId, notSubmitted: null };
        } catch (err) {
          return { poId, notSubmitted: `Saved, but not submitted. ${orderFailure(err, "Submitting an order").message}` };
        }
      } catch (err) {
        const own = err instanceof Error && err.constructor === Error;
        set({ saveError: own ? err.message : saveMessage(err) });
        return null;
      } finally {
        set({ saving: false });
      }
    },
  };
}

function saveMessage(err: unknown): string {
  const f = orderFailure(err, "Saving an order");
  return f.unsure ? `${f.message} Your order is kept on this phone; saving again first checks whether this one arrived.` : f.message;
}

export type DraftStore = ReturnType<typeof createDraftStore>;
