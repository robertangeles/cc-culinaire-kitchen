import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { wasteHandlers, type WasteLogCommand } from "./wasteCommands";

const log = (over: Partial<WasteLogCommand> = {}): WasteLogCommand => ({
  wasteLogId: "11111111-1111-4111-8111-111111111111",
  storeLocationId: "L1",
  ingredientName: "Chicken trim",
  quantity: 2.5,
  unit: "kg",
  reason: "Trim/Peel",
  shift: "Lunch",
  estimatedCost: null,
  notes: null,
  loggedAt: "2026-11-23T01:00:00.000Z",
  ...over,
});

function setup(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: wasteHandlers({ request } as unknown as ApiClient), now: () => 1_000_000, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, request, rows: () => [...rows.values()] };
}

describe("waste requests", () => {
  it("sends a log with its client-made id and location, so a repeat finds the same row", async () => {
    const { outbox, request } = setup();
    const full = log({ estimatedCost: 4.2, notes: "off" });
    await outbox.enqueueCommand("waste.log", full);
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/waste", { body: full });
  });

  it("leaves out what was not filled in, as the web does", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("waste.log", log({ reason: null, shift: null, notes: null, estimatedCost: null }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/waste", { body: { wasteLogId: log().wasteLogId, storeLocationId: "L1", ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", loggedAt: log().loggedAt } });
  });

  it("sends an edit as a PATCH of only what changed, with cleared fields as null, and a delete as a DELETE", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("waste.edit", { wasteLogId: "w1", label: "Chicken trim", changes: { quantity: 3, reason: null } });
    await outbox.enqueueCommand("waste.delete", { wasteLogId: "w2", label: "Basil" });
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("PATCH", "/api/waste/w1", { body: { quantity: 3, reason: null } });
    expect(request).toHaveBeenCalledWith("DELETE", "/api/waste/w2", {});
  });
});

describe("waste outcomes", () => {
  const fail = async (err: ApiError, type: "waste.log" | "waste.delete" | "waste.edit" = "waste.log") => {
    const t = setup(vi.fn(async () => { throw err; }));
    await t.outbox.enqueueCommand(type, type === "waste.log" ? log() : type === "waste.edit" ? { wasteLogId: "w1", label: "x", changes: { quantity: 1 } } : { wasteLogId: "w1", label: "x" });
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("keeps a location refusal visible with the server's words", async () => {
    expect(await fail(new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access", message: "You don't work at that location" } });
  });

  it("keeps an id clash visible (a real conflict, not 'already applied': the server answers a repeat of our own row with 200)", async () => {
    expect((await fail(new ApiError("conflict", "That id is already used by another entry", 409, undefined, "CONFLICT"))).status).toBe("NEEDS_ATTENTION");
  });

  it("treats a delete of an entry that is already gone as done, however the server words it", async () => {
    expect((await fail(new ApiError("not_found", "not found or not yours", 404), "waste.delete")).status).toBe("ACCEPTED");
  });

  it("keeps an edit of an entry that is gone visible", async () => {
    expect(await fail(new ApiError("not_found", "Waste log entry not found or not yours", 404, undefined, "NOT_FOUND"), "waste.edit")).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected" } });
  });

  it("stops retrying a command the server keeps failing on after five tries (the engine counts, the handler sets the limit)", () => {
    expect(wasteHandlers({} as ApiClient).map((h) => h.maxServerFailures)).toEqual([5, 5, 5]);
  });
});

describe("editing and deleting what has not been sent", () => {
  it("an edit of an unsent log changes the log itself: one request, the final values", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("waste.log", log());
    await outbox.enqueueCommand("waste.edit", { wasteLogId: log().wasteLogId, label: "Chicken trim", changes: { quantity: 4, reason: null } });
    await outbox.enqueueCommand("waste.edit", { wasteLogId: log().wasteLogId, label: "Chicken trim", changes: { notes: "off" } });
    expect(rows()).toHaveLength(1);
    await outbox.drain();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("POST", "/api/waste", { body: expect.objectContaining({ quantity: 4, notes: "off", ingredientName: "Chicken trim" }) });
    expect((request.mock.calls[0][2] as { body: Record<string, unknown> }).body).not.toHaveProperty("reason");
  });

  it("deleting an unsent log cancels it: the server never hears of it", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("waste.log", log());
    expect(await outbox.enqueueCommand("waste.delete", { wasteLogId: log().wasteLogId, label: "Chicken trim" })).toBeNull();
    await outbox.drain();
    expect(rows()).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("merges two unsent edits, and a delete replaces an unsent edit", async () => {
    const { outbox, rows } = setup();
    await outbox.enqueueCommand("waste.edit", { wasteLogId: "w1", label: "x", changes: { quantity: 3 } });
    await outbox.enqueueCommand("waste.edit", { wasteLogId: "w1", label: "x", changes: { reason: "Expired" } });
    expect(rows().map((r) => r.command)).toEqual([{ wasteLogId: "w1", label: "x", changes: { quantity: 3, reason: "Expired" } }]);
    await outbox.enqueueCommand("waste.delete", { wasteLogId: "w1", label: "x" });
    expect(rows().map((r) => r.type)).toEqual(["waste.delete"]);
  });

  it("an edit of an entry already on the server is its own request, sent after the log", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("waste.log", log());
    await outbox.drain(); // accepted
    await outbox.enqueueCommand("waste.edit", { wasteLogId: log().wasteLogId, label: "x", changes: { quantity: 9 } });
    await outbox.drain();
    expect(request.mock.calls.map((c) => c[0])).toEqual(["POST", "PATCH"]);
  });

  it("describes each command for the sync list", () => {
    const { outbox } = setup();
    expect(outbox.describe({ type: "waste.log", command: log() } as unknown as OutboxEntry<unknown>)).toBe("Waste: 2.5 kg Chicken trim");
    expect(outbox.describe({ type: "waste.edit", command: { wasteLogId: "w", label: "Basil", changes: {} } } as unknown as OutboxEntry<unknown>)).toBe("Change to waste entry: Basil");
    expect(outbox.describe({ type: "waste.delete", command: { wasteLogId: "w", label: "Basil" } } as unknown as OutboxEntry<unknown>)).toBe("Delete waste entry: Basil");
  });
});
