/**
 * The waste screens' data: today's entries from the server (kept on the phone for no-signal starts) with the waste
 * commands still in the queue laid over them. Logging, editing and deleting only write to the queue; sending is the
 * outbox's job, so every action works with no signal and the same way with signal.
 */

import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { Recents } from "../ingredients/recents";
import type { PickedIngredient } from "../ingredients/source";
import type { WasteEntry } from "@culinaire/shared/schemas/waste";
import type { WasteApi } from "./wasteApi";
import { WASTE_DELETE, WASTE_EDIT, WASTE_LOG, WASTE_TYPES, type WasteChanges, type WasteDeleteCommand, type WasteEditCommand, type WasteLogCommand } from "./wasteCommands";
import { dayTotals, localDayBounds, mergeWaste, type DayTotals, type WasteRow } from "./wasteView";

/** What a quick-log button repeats: the item, the unit it was last logged in and how much. */
export type WasteRecent = PickedIngredient & { quantity?: number };

export interface WasteForm {
  ingredientName: string;
  ingredientId?: string;
  quantity: number;
  unit: string;
  reason: string | null;
  shift: string | null;
  estimatedCost: number | null;
  notes: string | null;
}

export interface WasteSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  rows: WasteRow[];
  totals: DayTotals;
  recents: WasteRecent[];
  /** Waste commands saved on the phone and not yet on the server. */
  waiting: number;
  /** Waste commands the server refused or keeps failing on. */
  attention: number;
}

export interface WasteStoreDeps {
  api: WasteApi;
  kv: KvStore;
  outbox: Outbox;
  recents: Recents<WasteRecent>;
  getUserId: () => number;
  locationId: string;
  /** Ask the sender to run (the outbox drain), e.g. right after something is saved. */
  kick: () => void;
  now: () => number;
  newId: () => string;
}

const QUICK_LOG_ITEMS = 6;
const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

export function createWasteStore({ api, kv, outbox, recents, getUserId, locationId, kick, now, newId }: WasteStoreDeps) {
  // Per account: another cook signing in on this phone must never see this one's entries.
  const cacheKey = `waste.${getUserId()}.${locationId}`;
  let serverRows: WasteEntry[] = [];
  /** How many waste commands had been accepted when we last looked; null until the first look (earlier ones are not news). */
  let acceptedSeen: number | null = null;
  let snapshot: WasteSnapshot = { phase: "loading", offline: false, rows: [], totals: dayTotals([]), recents: [], waiting: 0, attention: 0 };
  const listeners = new Set<() => void>();

  const set = (next: Partial<WasteSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** Lay the queue over the server's rows. */
  async function rebuild() {
    const entries = await outbox.entriesOfTypes(WASTE_TYPES);
    const rows = mergeWaste(serverRows, entries, localDayBounds(new Date(now())));
    const open = entries.filter((e) => e.status !== "ACCEPTED");
    const accepted = entries.length - open.length;
    set({ rows, totals: dayTotals(rows), recents: (await recents.list()).slice(0, QUICK_LOG_ITEMS), waiting: open.filter((e) => e.status !== "NEEDS_ATTENTION").length, attention: open.filter((e) => e.status === "NEEDS_ATTENTION").length });
    // Something was just sent: the server's list now holds it, so load it and stop relying on the local copy.
    if (acceptedSeen !== null && accepted > acceptedSeen && snapshot.phase === "ready") void store.refresh();
    acceptedSeen = accepted;
  }

  const unsubscribe = outbox.subscribe(() => void rebuild());

  async function enqueue<C>(type: string, command: C) {
    await outbox.enqueueCommand(type, command);
    await rebuild();
    kick();
  }

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispose: unsubscribe,

    /** Download today's entries, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      const day = localDayBounds(new Date(now()));
      try {
        serverRows = await api.list(day, locationId);
        await kv.set(cacheKey, JSON.stringify({ day: day.start, rows: serverRows }));
        set({ phase: "ready", offline: false, error: undefined });
      } catch (err) {
        if (isOffline(err)) {
          const cached = JSON.parse((await kv.get(cacheKey)) ?? "null") as { day: string; rows: WasteEntry[] } | null;
          serverRows = cached?.day === day.start ? cached.rows : [];
          set({ phase: "ready", offline: true, error: undefined });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await rebuild();
    },

    /** Log waste: saved on the phone at once with a new id, sent when it can be. */
    async log(form: WasteForm): Promise<void> {
      const ingredientName = form.ingredientName.trim();
      if (!ingredientName) throw new Error("Say what was thrown away.");
      if (!Number.isFinite(form.quantity) || form.quantity <= 0) throw new Error("Enter a quantity above zero.");
      if (!form.unit) throw new Error("Choose a unit.");
      const command: WasteLogCommand = { wasteLogId: newId(), storeLocationId: locationId, ingredientName, quantity: form.quantity, unit: form.unit, reason: form.reason, shift: form.shift, estimatedCost: form.estimatedCost, notes: form.notes?.trim() || null, loggedAt: new Date(now()).toISOString() };
      await recents.remember({ name: ingredientName, ingredientId: form.ingredientId, unit: form.unit, quantity: form.quantity });
      await enqueue(WASTE_LOG, command);
    },

    async edit(wasteLogId: string, changes: WasteChanges): Promise<void> {
      const row = snapshot.rows.find((r) => r.wasteLogId === wasteLogId);
      const command: WasteEditCommand = { wasteLogId, label: changes.ingredientName ?? row?.ingredientName ?? "entry", changes };
      await enqueue(WASTE_EDIT, command);
    },

    async remove(wasteLogId: string): Promise<void> {
      const row = snapshot.rows.find((r) => r.wasteLogId === wasteLogId);
      const command: WasteDeleteCommand = { wasteLogId, label: row?.ingredientName ?? "entry" };
      await enqueue(WASTE_DELETE, command);
    },

    async retry(entryId: string): Promise<void> {
      await outbox.retry(entryId);
      kick();
    },

    async discard(entryId: string): Promise<void> {
      await outbox.discard(entryId);
    },
  };
  return store;
}

export type WasteStore = ReturnType<typeof createWasteStore>;
