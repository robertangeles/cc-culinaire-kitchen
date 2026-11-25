import { describe, it, expect, vi } from "vitest";
import type { KvStore } from "../storage/kv";
import { ApiError } from "../api/client";
import { createCachedList } from "./cachedList";

type Row = { id: string };
const memoryKv = (): KvStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
};
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const make = (fetch: (offset: number) => Promise<Row[]>, kv: KvStore = memoryKv(), pageSize = 2) =>
  createCachedList<Row>({ kv, key: "k", fetch, schema: { parse: (d) => d as Row[] }, id: (r) => r.id, pageSize, message: (e) => (e instanceof Error ? e.message : "?"), now: () => "2026-11-25T08:00:00Z" });
const down = async () => { throw new ApiError("network"); };

describe("a list kept on the phone", () => {
  it("shows what the server sent", async () => {
    const list = make(async () => rows("a"));
    expect(list.getSnapshot().phase).toBe("loading");
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ phase: "ready", items: rows("a"), savedAt: null, error: null, hasMore: false });
  });

  it("opened with no signal shows the last download, when it was made, and why", async () => {
    const kv = memoryKv();
    await make(async () => rows("a", "b"), kv).refresh();
    const later = make(down, kv);
    await later.refresh();
    expect(later.getSnapshot()).toMatchObject({ phase: "ready", items: rows("a", "b"), savedAt: "2026-11-25T08:00:00Z", error: "Can't reach the server. Try again.", hasMore: false });
  });

  it("with no signal and nothing saved is an error, and a damaged copy counts as nothing saved", async () => {
    const kv = memoryKv();
    kv.data.set("k", "{not json");
    const list = make(down, kv);
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ phase: "error", items: [] });
  });

  it("keeps the rows on screen when only a refresh failed", async () => {
    const fetch = vi.fn(async () => rows("a"));
    const list = make(fetch);
    await list.refresh();
    fetch.mockImplementationOnce(down);
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ phase: "ready", items: rows("a"), savedAt: "2026-11-25T08:00:00Z" });
  });

  it("forgets the rows, on screen and on the phone, when the server refuses them", async () => {
    const kv = memoryKv();
    const fetch = vi.fn(async () => rows("a"));
    const list = make(fetch, kv);
    await list.refresh();
    fetch.mockRejectedValueOnce(new ApiError("forbidden", "No access", 403));
    await list.refresh();
    expect(list.getSnapshot()).toMatchObject({ phase: "error", items: [], error: "No access" });
    expect(kv.data.has("k")).toBe(false);
  });

  it("adds the next page, each row once, and stops at a short one", async () => {
    const fetch = vi.fn(async (offset: number) => (offset === 0 ? rows("a", "b") : rows("b", "c").slice(0, offset === 2 ? 2 : 0)));
    const list = make(fetch);
    await list.refresh();
    expect(list.getSnapshot().hasMore).toBe(true);
    await list.loadMore();
    expect(list.getSnapshot().items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    await list.loadMore();
    expect(fetch).toHaveBeenLastCalledWith(4);
    expect(list.getSnapshot().hasMore).toBe(false);
    await list.loadMore();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("a newer refresh wins over a slower older one", async () => {
    let slow!: (r: Row[]) => void;
    const fetch = vi.fn().mockReturnValueOnce(new Promise<Row[]>((r) => (slow = r))).mockResolvedValueOnce(rows("new"));
    const list = make(fetch);
    const first = list.refresh();
    await list.refresh();
    slow(rows("old"));
    await first;
    expect(list.getSnapshot().items).toEqual(rows("new"));
  });
});
