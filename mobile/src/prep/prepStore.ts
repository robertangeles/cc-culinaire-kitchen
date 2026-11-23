/**
 * The prep screens' data: today's list for this location from the server (kept on the phone for no-signal starts) with the
 * prep commands still in the queue laid over it. Ticking and making the list only write to the queue; sending is the
 * outbox's job, so every action works with no signal and the same way with signal.
 */

import { PrepMenuSchema, type PrepMenu, type PrepSelection, type PrepSelectionInput, type PrepToday } from "@culinaire/shared/schemas/prep";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { PrepApi } from "./prepApi";
import { PREP_CREATE, PREP_GENERATE, PREP_SELECTIONS, PREP_TICK, PREP_TYPES, type PrepCreateCommand, type PrepGenerateCommand, type PrepSelectionsCommand, type PrepTickCommand, type PrepTickStatus } from "./prepCommands";
import { localDate, mergePrep, type PrepList } from "./prepView";

export interface PrepSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  list: PrepList;
  /** Prep commands saved on the phone and not yet on the server. */
  waiting: number;
  /** Prep commands the server refused or keeps failing on. */
  attention: number;
}

export interface PrepStoreDeps {
  api: PrepApi;
  kv: KvStore;
  outbox: Outbox;
  getUserId: () => number;
  locationId: string;
  /** Ask the sender to run (the outbox drain), e.g. right after something is saved. */
  kick: () => void;
  now: () => number;
  newId: () => string;
}

export interface PrepChoices {
  menu: PrepMenu;
  previous: PrepSelection[];
  /** True when the menu is the copy kept on the phone. */
  offline: boolean;
}

const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");
const emptyList: PrepList = { session: null, rows: [], progress: { done: 0, skipped: 0, total: 0 }, plan: null };

export function createPrepStore({ api, kv, outbox, getUserId, locationId, kick, now, newId }: PrepStoreDeps) {
  // Per account: another cook signing in on this phone must never see this one's list.
  const cacheKey = `prep.${getUserId()}.${locationId}`;
  const menuKey = `prep.menu.${getUserId()}`;
  let serverToday: PrepToday | null = null;
  /** The newest read wins: an answer to an older read, arriving late, is dropped. */
  let readSeq = 0;
  /** How many prep commands had been accepted when we last looked; null until the first look (earlier ones are not news). */
  let acceptedSeen: number | null = null;
  /** Ticks already laid into `serverToday`, so a tick that was just accepted stays on screen until the next read confirms it. */
  const applied = new Set<string>();
  let snapshot: PrepSnapshot = { phase: "loading", offline: false, list: emptyList, waiting: 0, attention: 0 };
  const listeners = new Set<() => void>();

  const set = (next: Partial<PrepSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** Lay the queue over the server's list. */
  async function rebuild() {
    const entries = await outbox.entriesOfTypes(PREP_TYPES);
    const accepted = entries.filter((e) => e.status === "ACCEPTED");
    const seeding = acceptedSeen === null;
    for (const e of accepted) {
      if (e.type !== PREP_TICK || applied.has(e.id)) continue;
      applied.add(e.id);
      if (seeding || !serverToday) continue; // sent before this store existed: the server's list already knows
      const c = e.command as PrepTickCommand;
      serverToday = { ...serverToday, tasks: serverToday.tasks.map((t) => (t.prepTaskId === c.prepTaskId ? { ...t, status: c.status, completedAt: c.status === "completed" ? c.completedAt : null, completedBy: c.status === "completed" ? getUserId() : null } : t)) };
    }
    const open = entries.filter((e) => e.status !== "ACCEPTED");
    set({ list: mergePrep(serverToday, entries, getUserId(), localDate(new Date(now())), locationId), waiting: open.filter((e) => e.status !== "NEEDS_ATTENTION").length, attention: open.filter((e) => e.status === "NEEDS_ATTENTION").length });
    // Something was just sent: the server's list now holds it, so read it and stop relying on the local copy.
    if (acceptedSeen !== null && accepted.length > acceptedSeen && snapshot.phase === "ready") void store.refresh();
    acceptedSeen = accepted.length;
  }

  const unsubscribe = outbox.subscribe(() => void rebuild());

  async function enqueue<C>(type: string, command: C) {
    await outbox.enqueueCommand(type, command);
    await rebuild();
  }

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispose: unsubscribe,

    /** Download today's list, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      const mine = ++readSeq;
      const date = localDate(new Date(now()));
      try {
        const fresh = await api.today(date, locationId);
        if (mine !== readSeq) return;
        serverToday = fresh;
        await kv.set(cacheKey, JSON.stringify({ date, today: fresh }));
        set({ phase: "ready", offline: false, error: undefined });
      } catch (err) {
        if (mine !== readSeq) return;
        if (isOffline(err)) {
          const cached = JSON.parse((await kv.get(cacheKey)) ?? "null") as { date: string; today: PrepToday | null } | null;
          serverToday = cached?.date === date ? cached.today : null;
          set({ phase: "ready", offline: true, error: undefined });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await rebuild();
    },

    /** Tick, untick or skip a task: saved on the phone at once, sent when it can be. */
    async setStatus(prepTaskId: string, status: PrepTickStatus): Promise<void> {
      const row = snapshot.list.rows.find((r) => r.prepTaskId === prepTaskId);
      if (!row) throw new Error("That task is not on today's list.");
      if (row.status === status) return;
      const command: PrepTickCommand = { prepTaskId, prepSessionId: row.prepSessionId, label: row.ingredientName, status, completedAt: status === "completed" ? new Date(now()).toISOString() : null };
      await enqueue(PREP_TICK, command);
      kick();
    },

    /** The dishes a cook can pick from (kept on the phone once downloaded) and the last plan's dishes to start from. */
    async loadChoices(): Promise<PrepChoices> {
      try {
        const [menu, previous] = await Promise.all([api.menu(), api.previousSelections().catch(() => [] as PrepSelection[])]);
        await kv.set(menuKey, JSON.stringify(menu));
        return { menu, previous, offline: false };
      } catch (err) {
        if (!isOffline(err)) throw new Error(err instanceof ApiError ? err.message : "Something went wrong. Try again.", { cause: err });
        const saved = PrepMenuSchema.safeParse(JSON.parse((await kv.get(menuKey)) ?? "null"));
        if (!saved.success) throw new Error("Connect to the internet once to load your menu.", { cause: err });
        return { menu: saved.data, previous: [], offline: true };
      }
    },

    /**
     * Make today's list: create the session (unless one is already there), save the dishes, generate. All three are saved on the
     * phone now and sent in that order. Never offered over a list that exists (generating again would wipe its ticks).
     */
    async makeList({ selections, expectedCovers }: { selections: PrepSelectionInput[]; expectedCovers: number | null }): Promise<void> {
      if (selections.length === 0) throw new Error("Pick at least one dish.");
      if (selections.some((s) => !Number.isInteger(s.expectedPortions) || s.expectedPortions < 1)) throw new Error("Every dish needs at least one portion.");
      if (expectedCovers !== null && (!Number.isInteger(expectedCovers) || expectedCovers < 1)) throw new Error("Covers must be a whole number above zero.");
      // A colleague may have made it since this phone last looked.
      await store.refresh();
      const { list } = snapshot;
      if (list.plan) throw new Error("Today's prep list is already being made.");
      if (list.rows.length > 0) throw new Error("Today's prep list is already made.");

      const prepSessionId = list.session?.prepSessionId ?? newId();
      if (!list.session) {
        const create: PrepCreateCommand = { prepSessionId, storeLocationId: locationId, prepDate: localDate(new Date(now())), expectedCovers };
        await enqueue(PREP_CREATE, create);
      }
      const dishes: PrepSelectionsCommand = { prepSessionId, selections };
      await enqueue(PREP_SELECTIONS, dishes);
      const generate: PrepGenerateCommand = { prepSessionId, requestId: newId() };
      await enqueue(PREP_GENERATE, generate);
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

export type PrepStore = ReturnType<typeof createPrepStore>;
