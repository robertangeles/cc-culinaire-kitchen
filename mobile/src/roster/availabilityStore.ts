/**
 * My availability, changed online. The last answer is kept sealed on the phone (`lockedCache`) and shown, with its time, when the server cannot be reached. A repeat is safe:
 * the server keeps one row per exact window (migration 0005) and answers a repeated add with the row it has.
 */

import { AvailabilityListSchema, type Availability } from "@culinaire/shared/schemas/roster";
import { ApiError } from "../api/client";
import { answerLost, onlineWrite, readMessage } from "../api/onlineWrite";
import type { StoreCache } from "../lock/lockedCache";
import { byWeek, sameWindow, type AvailabilityWindow } from "./availabilityView";
import type { RosterApi } from "./rosterApi";

export interface AvailabilitySnapshot {
  phase: "loading" | "ready" | "failed";
  off: boolean;
  error: string | null;
  /** When what is shown was saved, if it is the phone's copy because the server could not be reached. */
  savedAt: string | null;
  rows: Availability[];
}

export function createAvailabilityStore(api: Pick<RosterApi, "availability" | "addAvailability" | "changeAvailability" | "removeAvailability">, cache?: StoreCache) {
  let snapshot: AvailabilitySnapshot = { phase: "loading", off: false, error: null, savedAt: null, rows: [] };
  const listeners = new Set<() => void>();
  const set = (next: Partial<AvailabilitySnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  let reads = 0;

  /** True when it read what the server holds now. */
  async function refresh(): Promise<boolean> {
    const mine = ++reads;
    const owner = cache?.owner() ?? null;
    try {
      const rows = await api.availability();
      if (mine === reads) {
        set({ phase: "ready", off: false, error: null, savedAt: null, rows: [...rows].sort(byWeek) });
        void cache?.write("availability", owner, rows);
      }
      return true;
    } catch (err) {
      if (mine !== reads) return false;
      const code = err instanceof ApiError ? err.code : null;
      if (code === "not_found" || code === "forbidden") void cache?.remove("availability");
      if (code === "not_found") set({ phase: "ready", off: true, error: null, savedAt: null, rows: [] });
      else if (code === "forbidden") set({ phase: "failed", error: "You don't have access to the roster.", savedAt: null, rows: [] });
      else {
        const copy = snapshot.phase !== "ready" && answerLost(err) ? await cache?.read("availability", AvailabilityListSchema) : null;
        if (mine !== reads) return false;
        if (copy) set({ phase: "ready", off: false, error: readMessage(err), savedAt: copy.at, rows: [...copy.data].sort(byWeek) });
        else set({ phase: snapshot.phase === "ready" ? "ready" : "failed", error: readMessage(err) });
      }
      return false;
    }
  }

  const find = (id: string) => snapshot.rows.find((r) => r.staffAvailabilityId === id);

  return {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    refresh,
    find,
    add: (window: AvailabilityWindow) => onlineWrite({ run: () => api.addAvailability(window), read: refresh, landed: () => snapshot.rows.some((r) => sameWindow(r, window)) }),
    change: (id: string, window: AvailabilityWindow) =>
      onlineWrite({ run: () => api.changeAvailability(id, window), read: refresh, landed: () => { const row = find(id); return row !== undefined && sameWindow(row, window); } }),
    remove: (id: string) => onlineWrite({ run: () => api.removeAvailability(id), read: refresh, landed: () => find(id) === undefined, maybeDone: (err) => err.code === "not_found" }),
  };
}

export type AvailabilityStore = ReturnType<typeof createAvailabilityStore>;
