import { describe, it, expect, vi } from "vitest";
import type { ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import { ApiError, type ApiClient } from "../api/client";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import type { KvStore } from "../storage/kv";
import { createRecents } from "../ingredients/recents";
import { consumptionHandlers } from "./consumptionCommands";
import { createConsumptionStore, type ConsumptionRecent } from "./consumptionStore";
import type { ConsumptionApi } from "./consumptionApi";

// 2026-11-23 10:00 in the phone's own zone.
const NOW = new Date(2026, 10, 23, 10, 0).getTime();
const server = (over: Partial<ConsumptionEntry> = {}): ConsumptionEntry => ({ consumptionLogId: "c1", ingredientId: "i1", ingredientName: "Gin", quantity: 0.7, unit: "L", reason: "foh_operations", notes: null, shift: null, loggedAt: new Date(NOW - 3600_000).toISOString(), userId: 1, userName: "Cook", ...over });

function setup(over: { list?: ConsumptionApi["list"]; request?: ReturnType<typeof vi.fn>; rowsOnServer?: ConsumptionEntry[]; isAdmin?: boolean } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.request ?? vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: consumptionHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(2, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const list = over.list ?? vi.fn(async () => over.rowsOnServer ?? []);
  const recents = createRecents<ConsumptionRecent>({ kv, key: "recents", max: 8 });
  const kick = vi.fn();
  let uuid = 0;
  const usage = createConsumptionStore({ api: { list } as unknown as ConsumptionApi, kv, outbox, recents, viewer: { userId: 1, userName: "Cook", isAdmin: over.isAdmin ?? false }, locationId: "L1", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  return { usage, outbox, list, kick, kv, request };
}

const form = { ingredientId: "i2", ingredientName: "Salt", unit: "kg", quantity: 2, reason: "kitchen_operations", shift: "morning", notes: null };

describe("loading the day", () => {
  it("shows today's entries at the location and keeps them on the phone for the next time with no signal", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.usage.refresh();
    expect(t.usage.getSnapshot()).toMatchObject({ phase: "ready", offline: false });
    expect(t.usage.getSnapshot().rows.map((r) => r.ingredientName)).toEqual(["Gin"]);
    expect(t.list).toHaveBeenCalledWith({ start: new Date(2026, 10, 23).toISOString(), end: new Date(new Date(2026, 10, 24).getTime() - 1).toISOString() }, "L1");

    const offline = setup({ list: vi.fn(async () => { throw new ApiError("network"); }) });
    await offline.kv.set("consumption.1.L1", (await t.kv.get("consumption.1.L1"))!);
    await offline.usage.refresh();
    expect(offline.usage.getSnapshot()).toMatchObject({ phase: "ready", offline: true });
    expect(offline.usage.getSnapshot().rows.map((r) => r.ingredientName)).toEqual(["Gin"]);
  });

  it("opens empty and offline on a first run with no signal; other failures are shown as errors", async () => {
    const t = setup({ list: vi.fn(async () => { throw new ApiError("network"); }) });
    await t.usage.refresh();
    expect(t.usage.getSnapshot()).toMatchObject({ phase: "ready", offline: true, rows: [] });
    const bad = setup({ list: vi.fn(async () => { throw new ApiError("forbidden", "You need inventory access", 403); }) });
    await bad.usage.refresh();
    expect(bad.usage.getSnapshot()).toMatchObject({ phase: "error", error: "You need inventory access" });
  });
});

describe("logging", () => {
  it("saves on the phone first: the entry is on the list as waiting, nothing is asked of the network, and the sender is kicked", async () => {
    const t = setup();
    await t.usage.refresh();
    await t.usage.log(form);
    const snap = t.usage.getSnapshot();
    expect(snap.rows).toMatchObject([{ ingredientName: "Salt", quantity: 2, sync: "waiting", userName: "Cook" }]);
    expect(snap.totals).toEqual({ entries: 1, used: [{ unit: "kg", quantity: 2 }], returned: [] });
    expect(snap.waiting).toBe(1);
    expect(t.kick).toHaveBeenCalled();
    expect(t.request).not.toHaveBeenCalled();
    const [entry] = await t.outbox.open(["consumption.log"]);
    expect(entry.command).toMatchObject({ consumptionLogId: "00000000-0000-4000-8000-000000000001", storeLocationId: "L1", ingredientId: "i2", loggedAt: new Date(NOW).toISOString() });
  });

  it("sends it when the queue drains, the entry becomes synced, and the server's list is loaded again", async () => {
    const t = setup();
    await t.usage.refresh();
    await t.usage.log(form);
    await t.outbox.drain();
    expect(t.usage.getSnapshot().rows[0].sync).toBe("synced");
    await vi.waitFor(() => expect(t.list).toHaveBeenCalledTimes(2));
  });

  it("refuses nonsense before it is saved: no item picked, no quantity, a negative one, no reason", async () => {
    const t = setup();
    await expect(t.usage.log({ ...form, ingredientId: "" })).rejects.toThrow(/pick the item/i);
    await expect(t.usage.log({ ...form, unit: "" })).rejects.toThrow(/unit is not known/i);
    await expect(t.usage.log({ ...form, quantity: 0 })).rejects.toThrow(/quantity/i);
    await expect(t.usage.log({ ...form, quantity: -1 })).rejects.toThrow(/quantity/i);
    await expect(t.usage.log({ ...form, quantity: Number.NaN })).rejects.toThrow(/quantity/i);
    await expect(t.usage.log({ ...form, reason: "" })).rejects.toThrow(/used for/i);
    expect(await t.outbox.open(["consumption.log"])).toEqual([]);
  });

  it("remembers what was logged, with its unit, quantity and reason, for the quick buttons", async () => {
    const t = setup();
    await t.usage.log(form);
    await t.usage.log({ ...form, ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: 0.7, reason: "foh_operations" });
    await vi.waitFor(() => expect(t.usage.getSnapshot().recents.map((r) => r.name)).toEqual(["Gin", "Salt"]));
    expect(t.usage.getSnapshot().recents[1]).toMatchObject({ ingredientId: "i2", unit: "kg", quantity: 2, reason: "kitchen_operations" });
  });
});

describe("changing and deleting", () => {
  it("edits an entry on the server as a queued change, shown at once", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.usage.refresh();
    await t.usage.edit("c1", { quantity: 4 });
    expect(t.usage.getSnapshot().rows[0]).toMatchObject({ quantity: 4, sync: "waiting" });
    await t.outbox.drain();
    expect(t.request).toHaveBeenCalledWith("PATCH", "/api/inventory/consumption-logs/c1", { body: { quantity: 4 } });
  });

  it("will not queue an edit to zero or less: the server would store it", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.usage.refresh();
    await expect(t.usage.edit("c1", { quantity: 0 })).rejects.toThrow(/quantity/i);
    expect(await t.outbox.open(["consumption.edit"])).toEqual([]);
  });

  it("deletes: gone from the list and totals at once, and a delete of an entry that never left the phone sends nothing", async () => {
    const t = setup({ rowsOnServer: [server()] });
    await t.usage.refresh();
    await t.usage.remove("c1");
    expect(t.usage.getSnapshot().rows).toEqual([]);
    await t.usage.log(form);
    await t.usage.remove(t.usage.getSnapshot().rows[0].consumptionLogId);
    expect(t.usage.getSnapshot().rows).toEqual([]);
    await t.outbox.drain();
    expect(t.request.mock.calls.map((c) => c[0])).toEqual(["DELETE"]);
  });

  it("an entry the server refused stays on the list until the person retries or discards it", async () => {
    const request = vi.fn(async () => { throw new ApiError("bad_request", "Cannot convert bottle to kg", 422, undefined, "INCOMPATIBLE_UNITS"); });
    const t = setup({ request });
    await t.usage.log(form);
    await t.outbox.drain();
    const row = t.usage.getSnapshot().rows[0];
    expect(row).toMatchObject({ sync: "attention", attentionMessage: "Cannot convert bottle to kg" });
    expect(t.usage.getSnapshot().attention).toBe(1);
    await t.usage.retry(row.entryId!);
    expect(t.usage.getSnapshot().rows[0].sync).toBe("waiting");
    await t.outbox.drain();
    await t.usage.discard(t.usage.getSnapshot().rows[0].entryId!);
    expect(t.usage.getSnapshot().rows).toEqual([]);
  });
});

describe("whose entries can be changed", () => {
  it("lets a cook change their own and not another's; an Administrator may change any", async () => {
    const mine = server();
    const theirs = server({ consumptionLogId: "c2", userId: 9, userName: "Other" });
    const cook = setup({ rowsOnServer: [mine, theirs] });
    await cook.usage.refresh();
    const rows = cook.usage.getSnapshot().rows;
    expect(rows.map((r) => [r.consumptionLogId, cook.usage.canChange(r)]).sort()).toEqual([["c1", true], ["c2", false]]);
    const admin = setup({ rowsOnServer: [mine, theirs], isAdmin: true });
    await admin.usage.refresh();
    expect(admin.usage.getSnapshot().rows.every((r) => admin.usage.canChange(r))).toBe(true);
  });
});
