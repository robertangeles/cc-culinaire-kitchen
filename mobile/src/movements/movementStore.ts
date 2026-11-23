/**
 * The moves screens' data: the storage areas to move between and the latest moves at this location, both kept on the phone for
 * no-signal starts, with the move commands still in the queue laid over them. Recording a move only writes to the queue.
 */

import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { Recents } from "../ingredients/recents";
import type { PickedIngredient } from "../ingredients/source";
import type { StockMovement, StorageArea } from "@culinaire/shared/schemas/stockMovement";
import type { MovementApi } from "./movementApi";
import { MOVEMENT_LOG, MOVEMENT_TYPES, type MovementLogCommand } from "./movementCommands";
import { mergeMovements, type MovementRow } from "./movementView";

/** What a quick button repeats: the item, how much and between which areas. */
export type MovementRecent = PickedIngredient & { quantity?: number; fromStorageAreaId?: string; toStorageAreaId?: string };

export interface MovementForm {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  fromStorageAreaId: string;
  toStorageAreaId: string;
  notes: string | null;
}

export interface MovementSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  areas: StorageArea[];
  rows: MovementRow[];
  recents: MovementRecent[];
  waiting: number;
  attention: number;
}

export interface MovementStoreDeps {
  api: MovementApi;
  kv: KvStore;
  outbox: Outbox;
  recents: Recents<MovementRecent>;
  userId: number;
  userName: string;
  locationId: string;
  kick: () => void;
  now: () => number;
  newId: () => string;
}

const QUICK_ITEMS = 6;
const SHOWN = 20;
/** The server's own limits (`CreateMovementSchema`): checked here so a move it would refuse is not queued. */
const MAX_QUANTITY = 99999;
const MAX_NOTES = 500;
const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

export function createMovementStore({ api, kv, outbox, recents, userId, userName, locationId, kick, now, newId }: MovementStoreDeps) {
  // Per account: another cook signing in on this phone must never see this one's moves.
  const listKey = `movements.${userId}.${locationId}`;
  const areasKey = `movements.areas.${locationId}`;
  let serverRows: StockMovement[] = [];
  let acceptedSeen: number | null = null;
  let snapshot: MovementSnapshot = { phase: "loading", offline: false, areas: [], rows: [], recents: [], waiting: 0, attention: 0 };
  const listeners = new Set<() => void>();

  const set = (next: Partial<MovementSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  async function rebuild() {
    const entries = await outbox.entriesOfTypes(MOVEMENT_TYPES);
    const open = entries.filter((e) => e.status !== "ACCEPTED");
    const accepted = entries.length - open.length;
    set({ rows: mergeMovements(serverRows, entries, userName).slice(0, SHOWN), recents: (await recents.list()).slice(0, QUICK_ITEMS), waiting: open.filter((e) => e.status !== "NEEDS_ATTENTION").length, attention: open.filter((e) => e.status === "NEEDS_ATTENTION").length });
    // Something was just sent: the server's list now holds it, so load it and stop relying on the local copy.
    if (acceptedSeen !== null && accepted > acceptedSeen && snapshot.phase === "ready") void store.refresh();
    acceptedSeen = accepted;
  }

  const unsubscribe = outbox.subscribe(() => void rebuild());

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispose: unsubscribe,

    /** Download the areas and the latest moves, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      try {
        const [areas, moves] = await Promise.all([api.areas(locationId), api.list(locationId)]);
        serverRows = moves;
        await Promise.all([kv.set(areasKey, JSON.stringify(areas)), kv.set(listKey, JSON.stringify(moves))]);
        set({ phase: "ready", offline: false, error: undefined, areas });
      } catch (err) {
        if (isOffline(err)) {
          serverRows = JSON.parse((await kv.get(listKey)) ?? "[]") as StockMovement[];
          set({ phase: "ready", offline: true, error: undefined, areas: JSON.parse((await kv.get(areasKey)) ?? "[]") as StorageArea[] });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await rebuild();
    },

    /** Record a move: saved on the phone at once with a new id, sent when it can be. */
    async record(form: MovementForm): Promise<void> {
      if (!form.ingredientId) throw new Error("Pick the item from the list.");
      if (!Number.isFinite(form.quantity) || form.quantity <= 0) throw new Error("Enter how much moved.");
      if (form.quantity > MAX_QUANTITY) throw new Error("That's more than the app can record in one move.");
      const from = snapshot.areas.find((a) => a.storageAreaId === form.fromStorageAreaId);
      const to = snapshot.areas.find((a) => a.storageAreaId === form.toStorageAreaId);
      if (!from || !to) throw new Error("Choose where it moved from and to.");
      if (from.storageAreaId === to.storageAreaId) throw new Error("Pick two different areas.");
      const notes = form.notes?.trim() || null;
      if (notes && notes.length > MAX_NOTES) throw new Error("The note is too long.");
      const command: MovementLogCommand = { stockMovementId: newId(), storeLocationId: locationId, ingredientId: form.ingredientId, ingredientName: form.ingredientName, fromStorageAreaId: from.storageAreaId, fromAreaName: from.areaName, toStorageAreaId: to.storageAreaId, toAreaName: to.areaName, quantity: form.quantity, unit: form.unit, notes, movedAt: new Date(now()).toISOString() };
      await recents.remember({ name: form.ingredientName, ingredientId: form.ingredientId, unit: form.unit, quantity: form.quantity, fromStorageAreaId: from.storageAreaId, toStorageAreaId: to.storageAreaId });
      await outbox.enqueueCommand(MOVEMENT_LOG, command);
      await rebuild();
      kick();
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

export type MovementStore = ReturnType<typeof createMovementStore>;
