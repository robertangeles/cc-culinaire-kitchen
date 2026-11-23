import { describe, it, expect, vi } from "vitest";
import type { StockMovement, StorageArea } from "@culinaire/shared/schemas/stockMovement";
import { ApiError, type ApiClient } from "../api/client";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import type { KvStore } from "../storage/kv";
import { createRecents } from "../ingredients/recents";
import { movementHandlers } from "./movementCommands";
import { createMovementStore, type MovementRecent } from "./movementStore";
import type { MovementApi } from "./movementApi";

const NOW = new Date(2026, 10, 23, 10, 0).getTime();
const areas: StorageArea[] = [{ storageAreaId: "a1", areaName: "Stock Room" }, { storageAreaId: "a2", areaName: "Bar" }];
const server = (over: Partial<StockMovement> = {}): StockMovement => ({ stockMovementId: "m1", ingredientId: "i1", ingredientName: "Gin", quantity: 2, unit: "bottle", fromAreaName: "Stock Room", toAreaName: "Bar", userName: "Sam", notes: null, movedAt: new Date(NOW - 3600_000).toISOString(), ...over });

function setup(over: { areas?: MovementApi["areas"]; list?: MovementApi["list"]; request?: ReturnType<typeof vi.fn>; moves?: StockMovement[] } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.request ?? vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: movementHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(2, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const api = { areas: over.areas ?? vi.fn(async () => areas), list: over.list ?? vi.fn(async () => over.moves ?? []) } as unknown as MovementApi;
  const recents = createRecents<MovementRecent>({ kv, key: "recents", max: 8 });
  const kick = vi.fn();
  let uuid = 0;
  const moves = createMovementStore({ api, kv, outbox, recents, userId: 1, userName: "Cook", locationId: "L1", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  return { moves, outbox, kick, kv, request, api };
}

const form = { ingredientId: "i1", ingredientName: "Gin", unit: "bottle", quantity: 4, fromStorageAreaId: "a1", toStorageAreaId: "a2", notes: null };

describe("loading", () => {
  it("shows the areas and the latest moves, and keeps both on the phone for the next time with no signal", async () => {
    const t = setup({ moves: [server()] });
    await t.moves.refresh();
    expect(t.moves.getSnapshot()).toMatchObject({ phase: "ready", offline: false, areas });
    expect(t.moves.getSnapshot().rows.map((r) => [r.ingredientName, r.fromAreaName, r.toAreaName, r.sync])).toEqual([["Gin", "Stock Room", "Bar", "synced"]]);

    const offline = setup({ areas: vi.fn(async () => { throw new ApiError("network"); }), list: vi.fn(async () => { throw new ApiError("network"); }) });
    for (const k of ["movements.areas.L1", "movements.1.L1"]) await offline.kv.set(k, (await t.kv.get(k))!);
    await offline.moves.refresh();
    expect(offline.moves.getSnapshot()).toMatchObject({ phase: "ready", offline: true, areas });
    expect(offline.moves.getSnapshot().rows).toHaveLength(1);
  });

  it("opens empty and offline on a first run with no signal; other failures are shown as errors", async () => {
    const t = setup({ areas: vi.fn(async () => { throw new ApiError("network"); }), list: vi.fn(async () => { throw new ApiError("network"); }) });
    await t.moves.refresh();
    expect(t.moves.getSnapshot()).toMatchObject({ phase: "ready", offline: true, areas: [], rows: [] });
    const bad = setup({ areas: vi.fn(async () => { throw new ApiError("forbidden", "You need inventory access", 403); }) });
    await bad.moves.refresh();
    expect(bad.moves.getSnapshot()).toMatchObject({ phase: "error", error: "You need inventory access" });
  });
});

describe("recording a move", () => {
  it("saves on the phone first: the move is on the list as waiting, nothing is asked of the network, and the sender is kicked", async () => {
    const t = setup();
    await t.moves.refresh();
    await t.moves.record(form);
    expect(t.moves.getSnapshot().rows).toMatchObject([{ ingredientName: "Gin", quantity: 4, fromAreaName: "Stock Room", toAreaName: "Bar", sync: "waiting", userName: "Cook" }]);
    expect(t.moves.getSnapshot().waiting).toBe(1);
    expect(t.kick).toHaveBeenCalled();
    expect(t.request).not.toHaveBeenCalled();
    expect((await t.outbox.open(["movement.log"]))[0].command).toMatchObject({ stockMovementId: "00000000-0000-4000-8000-000000000001", storeLocationId: "L1", fromAreaName: "Stock Room" });
  });

  it("sends it when the queue drains, shows it synced, and loads the server's list again", async () => {
    const t = setup();
    await t.moves.refresh();
    await t.moves.record(form);
    await t.outbox.drain();
    expect(t.moves.getSnapshot().rows[0].sync).toBe("synced");
    await vi.waitFor(() => expect(t.api.list).toHaveBeenCalledTimes(2));
  });

  it("refuses what the server would refuse, before it is saved", async () => {
    const t = setup();
    await t.moves.refresh();
    await expect(t.moves.record({ ...form, ingredientId: "" })).rejects.toThrow(/pick the item/i);
    await expect(t.moves.record({ ...form, unit: "" })).rejects.toThrow(/unit is not known/i);
    await expect(t.moves.record({ ...form, quantity: 0 })).rejects.toThrow(/how much/i);
    await expect(t.moves.record({ ...form, quantity: 100000 })).rejects.toThrow(/more than/i);
    await expect(t.moves.record({ ...form, fromStorageAreaId: "" })).rejects.toThrow(/from and to/i);
    await expect(t.moves.record({ ...form, toStorageAreaId: "a1" })).rejects.toThrow(/two different/i);
    await expect(t.moves.record({ ...form, toStorageAreaId: "gone" })).rejects.toThrow(/from and to/i);
    await expect(t.moves.record({ ...form, notes: "x".repeat(501) })).rejects.toThrow(/too long/i);
    expect(await t.outbox.open(["movement.log"])).toEqual([]);
  });

  it("remembers the move, with its amount and areas, for the quick buttons", async () => {
    const t = setup();
    await t.moves.refresh();
    await t.moves.record(form);
    expect(t.moves.getSnapshot().recents[0]).toMatchObject({ name: "Gin", ingredientId: "i1", unit: "bottle", quantity: 4, fromStorageAreaId: "a1", toStorageAreaId: "a2" });
  });

  it("keeps a move the server refused on the list with its reason until the person retries or discards it", async () => {
    const request = vi.fn(async () => { throw new ApiError("not_found", "That 'to' area isn't at this location", 404, undefined, "NOT_FOUND"); });
    const t = setup({ request });
    await t.moves.refresh();
    await t.moves.record(form);
    await t.outbox.drain();
    const row = t.moves.getSnapshot().rows[0];
    expect(row).toMatchObject({ sync: "attention", attentionMessage: "That 'to' area isn't at this location" });
    expect(t.moves.getSnapshot().attention).toBe(1);
    await t.moves.retry(row.entryId!);
    expect(t.moves.getSnapshot().rows[0].sync).toBe("waiting");
    await t.outbox.drain();
    await t.moves.discard(t.moves.getSnapshot().rows[0].entryId!);
    expect(t.moves.getSnapshot().rows).toEqual([]);
  });
});
