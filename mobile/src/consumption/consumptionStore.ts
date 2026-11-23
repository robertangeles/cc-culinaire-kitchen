/**
 * The usage screens' data: today's entries at this location from the server (kept on the phone for no-signal starts) with the
 * consumption commands still in the queue laid over them. Logging, editing and deleting only write to the queue; sending is the
 * outbox's job, so every action works with no signal and the same way with signal.
 */

import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { Recents } from "../ingredients/recents";
import type { PickedIngredient } from "../ingredients/source";
import { localDayBounds } from "../waste/wasteView";
import type { ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import type { ConsumptionApi } from "./consumptionApi";
import { CONSUMPTION_DELETE, CONSUMPTION_EDIT, CONSUMPTION_LOG, CONSUMPTION_TYPES, type ConsumptionChanges, type ConsumptionDeleteCommand, type ConsumptionEditCommand, type ConsumptionLogCommand } from "./consumptionCommands";
import { canChange, dayTotals, mergeConsumption, type ConsumptionRow, type DayTotals, type Viewer } from "./consumptionView";

/** What a quick-log button repeats: the item, its unit, how much it was last and why. */
export type ConsumptionRecent = PickedIngredient & { quantity?: number; reason?: string };

export interface ConsumptionForm {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  reason: string;
  shift: string | null;
  notes: string | null;
}

export interface ConsumptionSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  rows: ConsumptionRow[];
  totals: DayTotals;
  recents: ConsumptionRecent[];
  /** Consumption commands saved on the phone and not yet on the server. */
  waiting: number;
  /** Consumption commands the server refused or keeps failing on. */
  attention: number;
}

export interface ConsumptionStoreDeps {
  api: ConsumptionApi;
  kv: KvStore;
  outbox: Outbox;
  recents: Recents<ConsumptionRecent>;
  viewer: Viewer;
  locationId: string;
  /** Ask the sender to run (the outbox drain), e.g. right after something is saved. */
  kick: () => void;
  now: () => number;
  newId: () => string;
}

const QUICK_LOG_ITEMS = 6;
const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

export function createConsumptionStore({ api, kv, outbox, recents, viewer, locationId, kick, now, newId }: ConsumptionStoreDeps) {
  // Per account: another cook signing in on this phone must never see this one's entries.
  const cacheKey = `consumption.${viewer.userId}.${locationId}`;
  let serverRows: ConsumptionEntry[] = [];
  /** How many consumption commands had been accepted when we last looked; null until the first look (earlier ones are not news). */
  let acceptedSeen: number | null = null;
  let snapshot: ConsumptionSnapshot = { phase: "loading", offline: false, rows: [], totals: dayTotals([]), recents: [], waiting: 0, attention: 0 };
  const listeners = new Set<() => void>();

  const set = (next: Partial<ConsumptionSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** Lay the queue over the server's rows. */
  async function rebuild() {
    const entries = await outbox.entriesOfTypes(CONSUMPTION_TYPES);
    const rows = mergeConsumption(serverRows, entries, localDayBounds(new Date(now())), viewer);
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
    canChange: (row: ConsumptionRow) => canChange(row, viewer),

    /** Download today's entries, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      const day = localDayBounds(new Date(now()));
      try {
        serverRows = await api.list(day, locationId);
        await kv.set(cacheKey, JSON.stringify({ day: day.start, rows: serverRows }));
        set({ phase: "ready", offline: false, error: undefined });
      } catch (err) {
        if (isOffline(err)) {
          const cached = JSON.parse((await kv.get(cacheKey)) ?? "null") as { day: string; rows: ConsumptionEntry[] } | null;
          serverRows = cached?.day === day.start ? cached.rows : [];
          set({ phase: "ready", offline: true, error: undefined });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await rebuild();
    },

    /** Log usage: saved on the phone at once with a new id, sent when it can be. */
    async log(form: ConsumptionForm): Promise<void> {
      if (!form.ingredientId) throw new Error("Pick the item from the list.");
      if (!Number.isFinite(form.quantity) || form.quantity <= 0) throw new Error("Enter a quantity above zero.");
      if (!form.reason) throw new Error("Say what it was used for.");
      const command: ConsumptionLogCommand = { consumptionLogId: newId(), storeLocationId: locationId, ingredientId: form.ingredientId, ingredientName: form.ingredientName, quantity: form.quantity, unit: form.unit, reason: form.reason, shift: form.shift, notes: form.notes?.trim() || null, loggedAt: new Date(now()).toISOString() };
      await recents.remember({ name: form.ingredientName, ingredientId: form.ingredientId, unit: form.unit, quantity: form.quantity, reason: form.reason });
      await enqueue(CONSUMPTION_LOG, command);
    },

    async edit(consumptionLogId: string, changes: ConsumptionChanges): Promise<void> {
      if (changes.quantity !== undefined && !(Number.isFinite(changes.quantity) && changes.quantity > 0)) throw new Error("Enter a quantity above zero.");
      const row = snapshot.rows.find((r) => r.consumptionLogId === consumptionLogId);
      const command: ConsumptionEditCommand = { consumptionLogId, label: row?.ingredientName ?? "entry", changes };
      await enqueue(CONSUMPTION_EDIT, command);
    },

    async remove(consumptionLogId: string): Promise<void> {
      const row = snapshot.rows.find((r) => r.consumptionLogId === consumptionLogId);
      const command: ConsumptionDeleteCommand = { consumptionLogId, label: row?.ingredientName ?? "entry" };
      await enqueue(CONSUMPTION_DELETE, command);
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

export type ConsumptionStore = ReturnType<typeof createConsumptionStore>;
