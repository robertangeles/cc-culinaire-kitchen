/**
 * A list read from the server a page at a time, with its first page kept on the phone: opened with no signal it shows what was last
 * downloaded and says so. Used for the orders (one list per filter), the approvals and the credit lists.
 */

import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";

export interface ListSnapshot<T> {
  phase: "loading" | "ready" | "error";
  items: T[];
  /** When these rows were downloaded, if they are the phone's saved copy because the server could not be reached. */
  savedAt: string | null;
  error: string | null;
  /** The server may have another page. */
  hasMore: boolean;
  loadingMore: boolean;
}

export interface CachedListDeps<T> {
  kv: KvStore;
  key: string;
  fetch: (offset: number) => Promise<T[]>;
  schema: { parse(data: unknown): T[] };
  id: (row: T) => string;
  pageSize: number;
  message: (err: unknown) => string;
  now: () => string;
}

const unreachable = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout" || err.code === "server");

export function createCachedList<T>({ kv, key, fetch, schema, id, pageSize, message, now }: CachedListDeps<T>) {
  let snapshot: ListSnapshot<T> = { phase: "loading", items: [], savedAt: null, error: null, hasMore: false, loadingMore: false };
  const listeners = new Set<() => void>();
  // A newer refresh wins over a slower older one.
  let generation = 0;
  /** Where the next page starts. shortcut: a row this version cannot read is not counted, so a page holding one reads as the last; count raw rows if a new server ever sends such rows. */
  let offset = 0;

  const set = (next: Partial<ListSnapshot<T>>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  async function saved(): Promise<{ at: string; items: T[] } | null> {
    try {
      const doc = JSON.parse((await kv.get(key)) ?? "null") as { at: string; items: unknown } | null;
      return doc && { at: doc.at, items: schema.parse(doc.items) };
    } catch {
      return null;
    }
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    set({ loadingMore: false });
    try {
      const items = await fetch(0);
      if (mine !== generation) return;
      offset = items.length;
      set({ phase: "ready", items, savedAt: null, error: null, hasMore: items.length >= pageSize });
      await kv.set(key, JSON.stringify({ at: now(), items }));
    } catch (err) {
      if (mine !== generation) return;
      if (!unreachable(err)) {
        // A refusal (a permission taken away) must not leave the old rows on screen or on the phone.
        await kv.delete(key).catch(() => undefined);
        if (mine === generation) set({ phase: "error", items: [], savedAt: null, error: message(err), hasMore: false });
        return;
      }
      // Rows already on screen stay; a fresh start falls back to the saved copy.
      const copy = await saved();
      if (mine !== generation) return;
      if (copy && snapshot.phase !== "ready") set({ phase: "ready", items: copy.items, savedAt: copy.at, error: message(err), hasMore: false });
      else if (copy) set({ savedAt: copy.at, error: message(err), hasMore: false });
      else set({ phase: snapshot.phase === "ready" ? "ready" : "error", error: message(err), hasMore: false });
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh,
    async loadMore(): Promise<void> {
      if (!snapshot.hasMore || snapshot.loadingMore) return;
      const mine = ++generation;
      set({ loadingMore: true, error: null });
      try {
        const next = await fetch(offset);
        if (mine !== generation) return;
        offset += next.length;
        const known = new Set(snapshot.items.map(id));
        set({ items: [...snapshot.items, ...next.filter((r) => !known.has(id(r)))], hasMore: next.length >= pageSize, loadingMore: false });
      } catch (err) {
        if (mine === generation) set({ loadingMore: false, error: message(err) });
      }
    },
  };
}

export type CachedList<T> = ReturnType<typeof createCachedList<T>>;
