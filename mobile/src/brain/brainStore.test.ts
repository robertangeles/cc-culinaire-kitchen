import { describe, expect, it, vi } from "vitest";
import type { Memory } from "@culinaire/shared/schemas/brain";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { BrainApi, MemoryFilter } from "./brainApi";
import { createBrainStore, PAGE } from "./brainStore";

const memory = (memoryId: string, over: Partial<Memory> = {}): Memory => ({ memoryId, title: memoryId, body: "b", sourceType: "chat", scope: "user", isPinned: false, status: "ready", createdDttm: "", canManage: true, authorName: null, ...over });

function setup(count = 3) {
  let rows = Array.from({ length: count }, (_, i) => memory(`m${i + 1}`));
  const list = vi.fn(async (f: MemoryFilter, offset: number, limit: number) => {
    const found = f.scope === "org" ? [memory("shared", { scope: "org" })] : f.search ? rows.filter((r) => r.memoryId.includes(f.search)) : rows;
    return { memories: found.slice(offset, offset + limit), total: found.length };
  });
  const remove = vi.fn(async (id: string) => void (rows = rows.filter((r) => r.memoryId !== id)));
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const make = () => createBrainStore({ api: { list, remove } as unknown as BrainApi, kv, userId: 7, now: () => "2026-11-26T09:00:00Z" });
  return { store: make(), make, list, remove, kvMap };
}
const ids = (s: { getSnapshot: () => { items: Memory[] } }) => s.getSnapshot().items.map((m) => m.memoryId);

describe("Your Brain store", () => {
  it("opens on what is private to you, then shows what the kitchen shared", async () => {
    const { store, list } = setup();
    await store.refresh();
    expect(list).toHaveBeenCalledWith({ scope: "user", sourceType: null, search: "" }, 0, PAGE);
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", total: 3, scope: "user" });
    await store.setFilter({ scope: "org" });
    expect(ids(store)).toEqual(["shared"]);
  });

  it("loads the next page from where it is, and a refresh keeps the rows already on screen", async () => {
    const { store, list } = setup(PAGE + 5);
    await store.refresh();
    await store.loadMore();
    expect(list).toHaveBeenLastCalledWith(expect.anything(), PAGE, PAGE);
    expect(ids(store)).toHaveLength(PAGE + 5);
    await store.refresh();
    expect(list).toHaveBeenLastCalledWith(expect.anything(), 0, PAGE + 5);
    expect(ids(store)).toHaveLength(PAGE + 5);
    const calls = list.mock.calls.length;
    await store.loadMore();
    expect(list.mock.calls.length).toBe(calls);
  });

  it("never asks for more than the server's hundred at once", async () => {
    const { store, list } = setup(130);
    await store.refresh();
    for (let i = 0; i < 6; i++) await store.loadMore();
    expect(ids(store)).toHaveLength(130);
    await store.refresh();
    expect(list).toHaveBeenLastCalledWith(expect.anything(), 0, 100);
    expect(ids(store)).toHaveLength(100);
    await store.loadMore();
    expect(ids(store)).toHaveLength(120);
  });

  it("a slower answer for the filter left behind does not replace the new one", async () => {
    const { store, list } = setup();
    let release: (v: unknown) => void = () => undefined;
    list.mockImplementationOnce(() => new Promise((r) => (release = r as never)));
    const old = store.refresh();
    await store.setFilter({ search: "m2" });
    release({ memories: [memory("late")], total: 1 });
    await old;
    expect(ids(store)).toEqual(["m2"]);
  });

  describe("with no signal", () => {
    it("shows the saved copy of that tier and says when it is from", async () => {
      const { store, make, list } = setup();
      await store.refresh();
      list.mockRejectedValue(new ApiError("network"));
      const again = make();
      await again.refresh();
      expect(again.getSnapshot()).toMatchObject({ phase: "ready", savedAt: "2026-11-26T09:00:00Z" });
      expect(ids(again)).toEqual(["m1", "m2", "m3"]);
    });

    it("never shows the saved copy as the answer to a search or a source", async () => {
      const { store, list } = setup();
      await store.refresh();
      list.mockRejectedValue(new ApiError("network"));
      await store.setFilter({ search: "m2" });
      expect(store.getSnapshot()).toMatchObject({ phase: "error", items: [], error: "Can't reach the server. Check your signal and try again." });
    });

    it("keeps no search result on the phone", async () => {
      const { store, kvMap } = setup();
      await store.setFilter({ search: "m2" });
      expect([...kvMap.keys()]).toEqual([]);
    });

    it("keeps the rows on screen when only a refresh fails", async () => {
      const { store, list } = setup();
      await store.refresh();
      list.mockRejectedValueOnce(new ApiError("timeout"));
      await store.refresh();
      expect(store.getSnapshot()).toMatchObject({ phase: "ready", total: 3 });
      expect(store.getSnapshot().savedAt).not.toBeNull();
    });
  });

  it("a refusal takes the rows off the screen and off the phone", async () => {
    const { store, list, kvMap } = setup();
    await store.refresh();
    expect(kvMap.size).toBe(1);
    list.mockRejectedValueOnce(new ApiError("forbidden", "Insufficient permissions"));
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ phase: "error", items: [], error: "Insufficient permissions" });
    expect(kvMap.size).toBe(0);
  });

  describe("removing a memory", () => {
    it("takes it off the list and off the saved copy", async () => {
      const { store, make, list, remove } = setup();
      await store.refresh();
      expect(await store.remove("m2")).toBeNull();
      expect(remove).toHaveBeenCalledWith("m2");
      expect(ids(store)).toEqual(["m1", "m3"]);
      expect(store.getSnapshot().total).toBe(2);
      list.mockRejectedValue(new ApiError("network"));
      const again = make();
      await again.refresh();
      expect(ids(again)).toEqual(["m1", "m3"]);
    });

    it("stays in the list when the server could not be reached, and says so", async () => {
      const { store, remove } = setup();
      await store.refresh();
      remove.mockRejectedValueOnce(new ApiError("network"));
      expect(await store.remove("m2")).toBe("Can't reach the server. Check your signal and try again.");
      expect(ids(store)).toEqual(["m1", "m2", "m3"]);
    });

    it("looks again when the server no longer has it (removed elsewhere, or no longer theirs)", async () => {
      const { store, remove, list } = setup();
      await store.refresh();
      remove.mockRejectedValueOnce(new ApiError("not_found", "Memory not found."));
      list.mockResolvedValueOnce({ memories: [memory("m1"), memory("m3")], total: 2 });
      expect(await store.remove("m2")).toBe("That memory was already removed, or is no longer yours to remove.");
      expect(ids(store)).toEqual(["m1", "m3"]);
    });

    it("does not come back with a list that was on its way when it was removed", async () => {
      const { store, list } = setup();
      await store.refresh();
      let release: (v: unknown) => void = () => undefined;
      list.mockImplementationOnce(() => new Promise((r) => (release = r as never)));
      const slow = store.refresh();
      await store.remove("m2");
      release({ memories: [memory("m1"), memory("m2"), memory("m3")], total: 3 });
      await slow;
      expect(ids(store)).toEqual(["m1", "m3"]);
      expect(store.getSnapshot().total).toBe(2);
    });
  });
});
