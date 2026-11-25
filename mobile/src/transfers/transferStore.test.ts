import { describe, it, expect, vi } from "vitest";
import type { TransferDetail, TransferSummary } from "@culinaire/shared/schemas/transfer";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import type { KvStore } from "../storage/kv";
import { transferHandlers } from "./transferCommands";
import type { TransferApi } from "./transferApi";
import { createTransferStore, type TransferForm } from "./transferStore";

const NOW = Date.UTC(2026, 10, 23, 1);
const summary = (over: Partial<TransferSummary> = {}): TransferSummary => ({ transferId: "t1", fromLocationId: "L2", toLocationId: "L1", status: "SENT", notes: null, sentDttm: null, receivedDttm: null, createdDttm: "2026-11-23T00:00:00.000Z", fromLocationName: "Bar", toLocationName: "Main", initiatorName: "Sam", lineCount: 1, ...over });
const detail: TransferDetail = { transferId: "t1", fromLocationId: "L2", toLocationId: "L1", status: "SENT", notes: null, sentDttm: null, receivedDttm: null, createdDttm: "2026-11-23T00:00:00.000Z", fromLocationName: "Bar", toLocationName: "Main", initiatedByUserId: 2, sentByUserId: 2, receivedByUserId: null, lines: [{ lineId: "l1", ingredientId: "i1", sentQty: 2, sentUnit: "L", receivedQty: null, lineStatus: "PENDING", ingredientName: "Gin", baseUnit: "L" }] };
const form = (over: Partial<TransferForm> = {}): TransferForm => ({ toLocationId: "L2", toLocationName: "Bar", lines: [{ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: "2" }], notes: "", sendNow: false, ...over });

function setup(over: { fail?: ApiError; list?: TransferSummary[]; pending?: TransferSummary[] } = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = vi.fn(async () => ({}));
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: transferHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => 1 });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const failing = <T>(v: () => T) => async () => { if (over.fail) throw over.fail; return v(); };
  const api = { list: vi.fn(failing(() => over.list ?? [summary()])), pending: vi.fn(failing(() => over.pending ?? [])), detail: vi.fn(failing(() => detail)), items: vi.fn(failing(() => [{ ingredientId: "i1", ingredientName: "Gin", ingredientCategory: "", itemType: "", baseUnit: "L", parLevel: null, activeInd: true, currentQty: 5, lastCountedDttm: null, supplierName: null }, { ingredientId: "i2", ingredientName: "Tonic", ingredientCategory: "", itemType: "", baseUnit: "each", parLevel: null, activeInd: true, lastCountedDttm: null, supplierName: null }])) } as unknown as TransferApi;
  let id = 0;
  const kick = vi.fn();
  const make = () => createTransferStore({ api, kv, outbox, userId: 1, userName: "Cook", locationId: "L1", locationName: "Main", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  return { make, api, over, request, outbox, kick, rows: () => [...rows.values()] };
}

describe("transfer list", () => {
  it("downloads the location's transfers and those on their way here, once each, and what this location has on hand", async () => {
    const s = setup({ list: [summary()], pending: [summary(), summary({ transferId: "old", createdDttm: "2026-10-01T00:00:00.000Z" })] }).make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: false });
    expect(s.getSnapshot().rows.map((r) => r.transferId)).toEqual(["t1", "old"]);
    await vi.waitFor(() => expect(s.getSnapshot().onHand).toEqual({ i1: 5 }));
  });

  it("shows the last download when there is no signal", async () => {
    const t = setup();
    await t.make().refresh();
    t.over.fail = new ApiError("network");
    const s = t.make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "ready", offline: true, rows: [expect.objectContaining({ transferId: "t1" })] });
  });

  it("shows the server's refusal in its words", async () => {
    const s = setup({ fail: new ApiError("forbidden", "You do not have access to this location", 403) }).make();
    await s.refresh();
    expect(s.getSnapshot()).toMatchObject({ phase: "error", error: "You do not have access to this location" });
  });

  it("keeps a transfer's detail on the phone for a no-signal receive", async () => {
    const t = setup();
    expect(await t.make().detail("t1")).toEqual({ detail, offline: false });
    t.over.fail = new ApiError("network");
    expect(await t.make().detail("t1")).toEqual({ detail, offline: true });
    expect(await t.make().detail("never-opened")).toEqual({ detail: null, offline: true });
  });
});

describe("making a transfer", () => {
  it("queues the transfer from this location with a phone-made id, and the send after it when asked", async () => {
    const t = setup({ list: [] });
    const s = t.make();
    await s.refresh();
    await s.create(form({ notes: " For Friday ", sendNow: true }));
    expect(t.rows().map((r) => [r.type, r.command])).toEqual([
      ["transfer.create", { transferId: "00000000-0000-4000-8000-000000000001", fromLocationId: "L1", fromLocationName: "Main", toLocationId: "L2", toLocationName: "Bar", lines: [{ ingredientId: "i1", ingredientName: "Gin", sentQty: 2, sentUnit: "L" }], notes: "For Friday", createdAt: new Date(NOW).toISOString() }],
      ["transfer.send", { transferId: "00000000-0000-4000-8000-000000000001", label: "Main to Bar" }],
    ]);
    expect(t.kick).toHaveBeenCalled();
    expect(s.getSnapshot().rows[0]).toMatchObject({ status: "SENT", sync: "waiting" });
  });

  it("refuses on the phone what the server would refuse, never on stock", async () => {
    const s = setup().make();
    await expect(s.create(form({ toLocationId: "" }))).rejects.toThrow("Choose where it's going.");
    await expect(s.create(form({ toLocationId: "L1" }))).rejects.toThrow("Choose where it's going.");
    await expect(s.create(form({ lines: [] }))).rejects.toThrow("Add at least one item.");
    await expect(s.create(form({ lines: [{ ingredientId: "", ingredientName: "Gin", unit: "L", quantity: "1" }] }))).rejects.toThrow("Pick Gin from the list.");
    await expect(s.create(form({ lines: [{ ingredientId: "i1", ingredientName: "Gin", unit: "", quantity: "1" }] }))).rejects.toThrow("Pick Gin from the list again: its unit is not known.");
    await expect(s.create(form({ lines: [{ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: "0" }] }))).rejects.toThrow("Enter how much Gin is going.");
    const twice = { ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: "1" };
    await expect(s.create(form({ lines: [twice, twice] }))).rejects.toThrow("Gin is on the transfer twice.");
    // Ten litres of gin with five on the books: allowed, as on the server (stock goes negative until the next count).
    await expect(s.create(form({ lines: [{ ...twice, quantity: "10" }] }))).resolves.toBeTruthy();
  });
});

describe("acting on a transfer", () => {
  it("queues send and cancel with the transfer's names", async () => {
    const t = setup({ list: [summary({ transferId: "a", status: "INITIATED", fromLocationId: "L1", toLocationId: "L2", fromLocationName: "Main", toLocationName: "Bar" })] });
    const s = t.make();
    await s.refresh();
    await s.send("a");
    expect(t.rows().map((r) => [r.type, r.command])).toEqual([["transfer.send", { transferId: "a", label: "Main to Bar" }]]);
  });

  it("queues what arrived, with whether it differs from what was sent", async () => {
    const t = setup();
    const s = t.make();
    await s.refresh();
    expect(await s.receive(detail, { l1: "1.5" })).toEqual({ ok: true, receivedLines: [{ lineId: "l1", receivedQty: 1.5 }], differences: [{ lineId: "l1", difference: -0.5 }] });
    expect(t.rows()[0].command).toEqual({ transferId: "t1", label: "Bar to Main", userId: 1, receivedLines: [{ lineId: "l1", receivedQty: 1.5 }], hasDifference: true });
    expect(s.getSnapshot().rows[0]).toMatchObject({ status: "DISCREPANCY", sync: "waiting" });
  });

  it("queues nothing for a quantity the server would refuse", async () => {
    const t = setup();
    const s = t.make();
    expect(await s.receive(detail, { l1: "-1" })).toMatchObject({ ok: false, lineId: "l1" });
    expect(t.rows()).toHaveLength(0);
  });
});
