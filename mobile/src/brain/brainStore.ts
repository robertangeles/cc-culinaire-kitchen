/**
 * Your Brain: what CulinAIre remembers, private or shared with the kitchen, a page at a time, filtered by source and searched on the server
 * as on the web. The first page of each tier is kept on the phone for a start with no signal; a search or a source never is.
 */

import { MemoryListSchema, type Memory } from "@culinaire/shared/schemas/brain";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { BrainApi, MemoryFilter } from "./brainApi";

export const PAGE = 20;
/** The most the server gives in one answer. */
const SERVER_MAX = 100;

export interface BrainSnapshot extends MemoryFilter {
  phase: "loading" | "ready" | "error";
  items: Memory[];
  total: number;
  /** Loading the next page. */
  more: boolean;
  /** When these rows were downloaded, if they are what was here before because the server could not be reached. */
  savedAt: string | null;
  error: string | null;
}

interface Saved {
  at: string;
  items: Memory[];
  total: number;
}

const unreachable = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout" || err.code === "server");

export function brainFailure(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.code === "network") return "Can't reach the server. Check your signal and try again.";
  return err.message;
}

export function createBrainStore({ api, kv, userId, now }: { api: Pick<BrainApi, "list" | "remove">; kv: KvStore; userId: number; now: () => string }) {
  let snapshot: BrainSnapshot = { phase: "loading", scope: "user", sourceType: null, search: "", items: [], total: 0, more: false, savedAt: null, error: null };
  const listeners = new Set<() => void>();
  // A newer request (another filter, a refresh) wins over a slower older one.
  let generation = 0;
  /** Rows removed here: a list that was on its way when one was removed must not bring it back. */
  const removed = new Set<string>();
  /** When the rows on screen came from the server. */
  let loadedAt: string | null = null;

  const set = (next: Partial<BrainSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const filter = (): MemoryFilter => ({ scope: snapshot.scope, sourceType: snapshot.sourceType, search: snapshot.search });
  const keyOf = (scope: string) => `brain.${userId}.${scope}`;
  const keepable = (f: MemoryFilter) => !f.sourceType && !f.search.trim();

  async function saved(scope: string): Promise<Saved | null> {
    try {
      const doc = JSON.parse((await kv.get(keyOf(scope))) ?? "null") as Saved | null;
      return doc && { ...doc, items: MemoryListSchema.parse(doc.items) };
    } catch {
      return null;
    }
  }
  const save = (scope: string, doc: Saved) => kv.set(keyOf(scope), JSON.stringify(doc)).catch(() => undefined);

  function without({ memories, total }: { memories: Memory[]; total: number }) {
    const items = memories.filter((m) => !removed.has(m.memoryId));
    return { items, total: total - (memories.length - items.length) };
  }

  async function load(): Promise<void> {
    const mine = ++generation;
    const f = filter();
    set({ more: false, error: null });
    try {
      // As many rows as are on screen, so a refresh never shortens the list.
      const page = without(await api.list(f, 0, Math.min(Math.max(PAGE, snapshot.items.length), SERVER_MAX)));
      if (mine !== generation) return;
      loadedAt = now();
      set({ phase: "ready", ...page, savedAt: null });
      if (keepable(f)) await save(f.scope, { at: loadedAt, items: page.items.slice(0, PAGE), total: page.total });
    } catch (err) {
      if (mine !== generation) return;
      if (!unreachable(err)) {
        // A refusal (the permission was taken away) must not leave the rows on screen or on the phone.
        await Promise.all(["user", "org"].map((scope) => kv.delete(keyOf(scope)).catch(() => undefined)));
        if (mine === generation) set({ phase: "error", items: [], total: 0, savedAt: null, error: brainFailure(err) });
        return;
      }
      if (snapshot.phase === "ready") return set({ savedAt: loadedAt, error: brainFailure(err) });
      const copy = keepable(f) ? await saved(f.scope) : null;
      if (mine !== generation) return;
      if (!copy) return set({ phase: "error", error: brainFailure(err) });
      loadedAt = copy.at;
      set({ phase: "ready", items: copy.items, total: copy.total, savedAt: copy.at, error: brainFailure(err) });
    }
  }

  /** Takes a row out of the saved copy, so it is not there on the next start with no signal. */
  async function forget(memoryId: string): Promise<void> {
    for (const scope of ["user", "org"]) {
      const copy = await saved(scope);
      const items = copy?.items.filter((m) => m.memoryId !== memoryId);
      if (copy && items && items.length < copy.items.length) await save(scope, { ...copy, items, total: copy.total - 1 });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh: load,

    setFilter(next: Partial<MemoryFilter>): Promise<void> {
      const changed = (Object.keys(next) as (keyof MemoryFilter)[]).some((k) => next[k] !== snapshot[k]);
      if (!changed) return Promise.resolve();
      set({ ...next, phase: "loading", items: [], total: 0, savedAt: null });
      return load();
    },

    async loadMore(): Promise<void> {
      if (snapshot.more || snapshot.phase !== "ready" || snapshot.items.length >= snapshot.total) return;
      const mine = ++generation;
      set({ more: true, error: null });
      try {
        const next = without(await api.list(filter(), snapshot.items.length, PAGE));
        if (mine !== generation) return;
        const known = new Set(snapshot.items.map((m) => m.memoryId));
        set({ items: [...snapshot.items, ...next.items.filter((m) => !known.has(m.memoryId))], total: next.total, more: false });
      } catch (err) {
        if (mine === generation) set({ more: false, error: brainFailure(err) });
      }
    },

    /** Removes it for good, on the web too. Answers what to tell the person, or null when it is gone. */
    async remove(memoryId: string): Promise<string | null> {
      try {
        await api.remove(memoryId);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "not_found")) return brainFailure(err);
        await load();
        return "That memory was already removed, or is no longer yours to remove.";
      }
      removed.add(memoryId);
      const items = snapshot.items.filter((m) => m.memoryId !== memoryId);
      set({ items, total: snapshot.total - (snapshot.items.length - items.length) });
      await forget(memoryId);
      return null;
    },
  };
}

export type BrainStore = ReturnType<typeof createBrainStore>;
