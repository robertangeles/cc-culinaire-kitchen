import { describe, it, expect, vi } from "vitest";
import type { WasteEntry } from "@culinaire/shared/schemas/waste";
import { ApiError } from "../api/client";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import type { KvStore } from "../storage/kv";
import { createRecents } from "../ingredients/recents";
import { wasteHandlers } from "./wasteCommands";
import { createWasteStore, type WasteRecent } from "./wasteStore";
import type { WasteApi } from "./wasteApi";
import type { ApiClient } from "../api/client";

// 2026-11-23 10:00 in the phone's own zone.
const NOW = new Date(2026, 10, 23, 10, 0).getTime();
const server = (over: Partial<WasteEntry> = {}): WasteEntry => ({ wasteLogId: "w1", userId: 1, storeLocationId: "L1", ingredientName: "Basil", quantity: 1, unit: "bunch", estimatedCost: null, reason: null, notes: null, shift: null, loggedAt: new Date(NOW - 3600_000).toISOString(), loggedBy: "Rob", ...over });

function setup(over: { list?: WasteApi["list"]; request?: ReturnType<typeof vi.fn>; rowsOnServer?: WasteEntry[] } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.request ?? vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: wasteHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(2, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const list = over.list ?? vi.fn(async () => over.rowsOnServer ?? []);
  const api = { list, suggestions: vi.fn(async () => []) } as unknown as WasteApi;
  const recents = createRecents<WasteRecent>({ kv, key: "recents", max: 8 });
  const kick = vi.fn();
  let uuid = 0;
  const waste = createWasteStore({ api, kv, outbox, recents, getUserId: () => 1, locationId: "L1", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  return { waste, outbox, list, kick, kv, recents, request, rows };
}

const form = { ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", reason: "Trim/Peel", shift: "Lunch", estimatedCost: null, notes: null };

describe("loading the day", () => {
  it("shows today's entries and keeps them on the phone for the next time with no signal", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.waste.refresh();
    expect(t.waste.getSnapshot()).toMatchObject({ phase: "ready", offline: false });
    expect(t.waste.getSnapshot().rows.map((r) => r.ingredientName)).toEqual(["Basil"]);

    const offline = setup({ list: vi.fn(async () => { throw new ApiError("network"); }) });
    await offline.kv.set("waste.1.L1", (await t.kv.get("waste.1.L1"))!);
    await offline.waste.refresh();
    expect(offline.waste.getSnapshot()).toMatchObject({ phase: "ready", offline: true });
    expect(offline.waste.getSnapshot().rows.map((r) => r.ingredientName)).toEqual(["Basil"]);
  });

  it("still opens, empty and offline, on a first run with no signal; other failures are shown as errors", async () => {
    const t = setup({ list: vi.fn(async () => { throw new ApiError("network"); }) });
    await t.waste.refresh();
    expect(t.waste.getSnapshot()).toMatchObject({ phase: "ready", offline: true, rows: [] });
    const bad = setup({ list: vi.fn(async () => { throw new ApiError("forbidden", "You need waste access", 403); }) });
    await bad.waste.refresh();
    expect(bad.waste.getSnapshot()).toMatchObject({ phase: "error", error: "You need waste access" });
  });
});

describe("logging", () => {
  it("saves on the phone first: the entry is on the list as waiting, nothing is asked of the network, and the sender is kicked", async () => {
    const t = setup();
    await t.waste.refresh();
    await t.waste.log(form);
    const snap = t.waste.getSnapshot();
    expect(snap.rows).toMatchObject([{ ingredientName: "Chicken trim", quantity: 2.5, sync: "waiting" }]);
    expect(snap.totals).toEqual({ entries: 1, cost: 0, byUnit: [{ unit: "kg", quantity: 2.5 }] });
    expect(snap.waiting).toBe(1);
    expect(t.kick).toHaveBeenCalled();
    expect(t.request).not.toHaveBeenCalled();
    const [entry] = await t.outbox.open(["waste.log"]);
    expect(entry.command).toMatchObject({ wasteLogId: "00000000-0000-4000-8000-000000000001", storeLocationId: "L1", loggedAt: new Date(NOW).toISOString() });
  });

  it("sends it when the queue drains and the entry becomes synced, then reloads the server's list", async () => {
    const t = setup();
    await t.waste.refresh();
    await t.waste.log(form);
    await t.outbox.drain();
    expect(t.waste.getSnapshot().rows[0].sync).toBe("synced");
    await vi.waitFor(() => expect(t.list).toHaveBeenCalledTimes(2));
  });

  it("refuses nonsense before it is saved: no name, no quantity, a negative one", async () => {
    const t = setup();
    await expect(t.waste.log({ ...form, ingredientName: "  " })).rejects.toThrow(/what was thrown away/i);
    await expect(t.waste.log({ ...form, quantity: 0 })).rejects.toThrow(/quantity/i);
    await expect(t.waste.log({ ...form, quantity: Number.NaN })).rejects.toThrow(/quantity/i);
    expect(await t.outbox.open(["waste.log"])).toEqual([]);
  });

  it("remembers what was logged, with its unit and quantity, for the quick buttons", async () => {
    const t = setup();
    await t.waste.log(form);
    await t.waste.log({ ...form, ingredientName: "Basil", quantity: 1, unit: "bunch", reason: null, shift: null });
    await vi.waitFor(() => expect(t.waste.getSnapshot().recents.map((r) => r.name)).toEqual(["Basil", "Chicken trim"]));
    expect(t.waste.getSnapshot().recents[1]).toMatchObject({ unit: "kg", quantity: 2.5 });
  });
});

describe("changing and deleting", () => {
  it("edits an entry on the server as a queued change, shown at once", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.waste.refresh();
    await t.waste.edit("w1", { quantity: 4 });
    expect(t.waste.getSnapshot().rows[0]).toMatchObject({ quantity: 4, sync: "waiting" });
    await t.outbox.drain();
    expect(t.request).toHaveBeenCalledWith("PATCH", "/api/waste/w1", { body: { quantity: 4 } });
  });

  it("deletes: gone from the list and totals at once, and a delete of an entry that never left the phone sends nothing", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.waste.refresh();
    await t.waste.remove("w1");
    expect(t.waste.getSnapshot().rows).toEqual([]);
    await t.waste.log(form);
    const id = t.waste.getSnapshot().rows[0].wasteLogId;
    await t.waste.remove(id);
    expect(t.waste.getSnapshot().rows).toEqual([]);
    await t.outbox.drain();
    expect(t.request.mock.calls.map((c) => c[0])).toEqual(["DELETE"]);
  });

  it("an entry the server refused stays on the list until the person retries or discards it", async () => {
    const request = vi.fn(async () => { throw new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"); });
    const t = setup({ request });
    await t.waste.log(form);
    await t.outbox.drain();
    const row = t.waste.getSnapshot().rows[0];
    expect(row).toMatchObject({ sync: "attention", attentionMessage: "You don't work at that location" });
    expect(t.waste.getSnapshot().attention).toBe(1);
    await t.waste.retry(row.entryId!);
    expect(t.waste.getSnapshot().rows[0].sync).toBe("waiting");
    await t.outbox.drain();
    await t.waste.discard(t.waste.getSnapshot().rows[0].entryId!);
    expect(t.waste.getSnapshot().rows).toEqual([]);
  });
});
