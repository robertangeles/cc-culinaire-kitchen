/**
 * My availability, in memory only and changed online (owner, Q6: no roster data is stored on the phone; offline storage is a later change, and the app lock now covers these holders). A repeat is safe:
 * the server keeps one row per exact window (migration 0005) and answers a repeated add with the row it has.
 */

import type { Availability } from "@culinaire/shared/schemas/roster";
import { ApiError } from "../api/client";
import { onlineWrite, readMessage } from "../api/onlineWrite";
import { byWeek, sameWindow, type AvailabilityWindow } from "./availabilityView";
import type { RosterApi } from "./rosterApi";

export interface AvailabilitySnapshot {
  phase: "loading" | "ready" | "failed";
  off: boolean;
  error: string | null;
  rows: Availability[];
}

export function createAvailabilityStore(api: Pick<RosterApi, "availability" | "addAvailability" | "changeAvailability" | "removeAvailability">) {
  let snapshot: AvailabilitySnapshot = { phase: "loading", off: false, error: null, rows: [] };
  const listeners = new Set<() => void>();
  const set = (next: Partial<AvailabilitySnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  let reads = 0;

  /** True when it read what the server holds now. */
  async function refresh(): Promise<boolean> {
    const mine = ++reads;
    try {
      const rows = await api.availability();
      if (mine === reads) set({ phase: "ready", off: false, error: null, rows: [...rows].sort(byWeek) });
      return true;
    } catch (err) {
      if (mine !== reads) return false;
      const code = err instanceof ApiError ? err.code : null;
      if (code === "not_found") set({ phase: "ready", off: true, error: null, rows: [] });
      else if (code === "forbidden") set({ phase: "failed", error: "You don't have access to the roster.", rows: [] });
      else set({ phase: snapshot.phase === "ready" ? "ready" : "failed", error: readMessage(err) });
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
