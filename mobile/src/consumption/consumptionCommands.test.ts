import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { consumptionHandlers, type ConsumptionLogCommand } from "./consumptionCommands";

const ID = "11111111-1111-4111-8111-111111111111";
const log = (over: Partial<ConsumptionLogCommand> = {}): ConsumptionLogCommand => ({
  consumptionLogId: ID,
  storeLocationId: "L1",
  ingredientId: "i1",
  ingredientName: "Gin",
  quantity: 0.7,
  unit: "L",
  reason: "foh_operations",
  shift: "evening",
  notes: null,
  loggedAt: "2026-11-23T01:00:00.000Z",
  ...over,
});

function setup(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const clock = { t: 1_000_000 };
  const outbox = createOutbox({ store, send: async () => {}, handlers: consumptionHandlers({ request } as unknown as ApiClient), now: () => clock.t, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, request, clock, rows: () => [...rows.values()] };
}

describe("consumption requests", () => {
  it("sends a log with its client-made id, location and the item's id, and without the phone-only fields", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("consumption.log", log({ notes: "Friday" }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/consumption-logs", { body: { consumptionLogId: ID, storeLocationId: "L1", ingredientId: "i1", quantity: 0.7, unit: "L", reason: "foh_operations", shift: "evening", notes: "Friday" } });
  });

  it("leaves out a shift and notes that were not filled in", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("consumption.log", log({ shift: null }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/consumption-logs", { body: { consumptionLogId: ID, storeLocationId: "L1", ingredientId: "i1", quantity: 0.7, unit: "L", reason: "foh_operations" } });
  });

  it("sends an edit as a PATCH of only what changed, a cleared note as null, and a delete as a DELETE", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: "c1", label: "Gin", changes: { quantity: 1, notes: null } });
    await outbox.enqueueCommand("consumption.delete", { consumptionLogId: "c2", label: "Salt" });
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("PATCH", "/api/inventory/consumption-logs/c1", { body: { quantity: 1, notes: null } });
    expect(request).toHaveBeenCalledWith("DELETE", "/api/inventory/consumption-logs/c2", {});
  });
});

describe("consumption outcomes", () => {
  const fail = async (err: ApiError, type: "consumption.log" | "consumption.delete" | "consumption.edit" = "consumption.log") => {
    const t = setup(vi.fn(async () => { throw err; }));
    await t.outbox.enqueueCommand(type, type === "consumption.log" ? log() : type === "consumption.edit" ? { consumptionLogId: "c1", label: "x", changes: { quantity: 1 } } : { consumptionLogId: "c1", label: "x" });
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("keeps a location refusal visible with the server's words", async () => {
    expect(await fail(new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access", message: "You don't work at that location" } });
  });

  it("keeps an id clash visible (the server answers a repeat of our own row with 200, so a 409 is someone else's id)", async () => {
    expect((await fail(new ApiError("conflict", "That id is already used by another entry", 409, undefined, "CONFLICT"))).status).toBe("NEEDS_ATTENTION");
  });

  it("keeps an item that cannot be converted to its unit visible (422 INCOMPATIBLE_UNITS), and an item the server does not know (404 NOT_FOUND)", async () => {
    expect(await fail(new ApiError("bad_request", "Cannot convert bottle to kg", 422, undefined, "INCOMPATIBLE_UNITS"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "Cannot convert bottle to kg" } });
    expect((await fail(new ApiError("not_found", "Ingredient not found or does not belong to this organisation", 404, undefined, "NOT_FOUND"))).status).toBe("NEEDS_ATTENTION");
  });

  it("keeps an edit or delete after the 24 hour window visible: that 409 is a refusal, never 'already applied'", async () => {
    const expired = () => new ApiError("conflict", "Cannot edit entries older than 24 hours", 409, undefined, "EDIT_WINDOW_EXPIRED");
    expect(await fail(expired(), "consumption.edit")).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "Cannot edit entries older than 24 hours" } });
    expect((await fail(expired(), "consumption.delete")).status).toBe("NEEDS_ATTENTION");
  });

  it("keeps an edit of someone else's entry visible (403 FORBIDDEN)", async () => {
    expect(await fail(new ApiError("forbidden", "Only the original logger or an admin can edit this entry", 403, undefined, "FORBIDDEN"), "consumption.edit")).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access" } });
  });

  it("treats a delete of an entry that is already gone as done (an older server answers 404)", async () => {
    expect((await fail(new ApiError("not_found", "Consumption log entry not found", 404), "consumption.delete")).status).toBe("ACCEPTED");
  });

  it("keeps an edit of an entry that is gone visible", async () => {
    expect((await fail(new ApiError("not_found", "Consumption log entry not found", 404, undefined, "NOT_FOUND"), "consumption.edit")).status).toBe("NEEDS_ATTENTION");
  });

  it("stops retrying a command the server keeps failing on after five tries", () => {
    expect(consumptionHandlers({} as ApiClient).map((h) => h.maxServerFailures)).toEqual([5, 5, 5]);
  });
});

describe("editing and deleting what has not been sent", () => {
  it("an edit of an unsent log changes the log itself: one request, the final values", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("consumption.log", log());
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: ID, label: "Gin", changes: { quantity: 2, shift: null } });
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: ID, label: "Gin", changes: { notes: "event" } });
    expect(rows()).toHaveLength(1);
    await outbox.drain();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/consumption-logs", { body: expect.objectContaining({ quantity: 2, notes: "event", ingredientId: "i1" }) });
    expect((request.mock.calls[0][2] as { body: Record<string, unknown> }).body).not.toHaveProperty("shift");
  });

  it("deleting an unsent log cancels it: the server never hears of it", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("consumption.log", log());
    expect(await outbox.enqueueCommand("consumption.delete", { consumptionLogId: ID, label: "Gin" })).toBeNull();
    await outbox.drain();
    expect(rows()).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("an edit of an entry already on the server is its own request, sent after the log", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("consumption.log", log());
    await outbox.drain();
    await outbox.enqueueCommand("consumption.edit", { consumptionLogId: ID, label: "Gin", changes: { quantity: 9 } });
    await outbox.drain();
    expect(request.mock.calls.map((c) => c[0])).toEqual(["POST", "PATCH"]);
  });

  it("a log the server may already hold (its reply was lost) is not changed or cancelled: an edit goes after it, and a delete replaces that edit", async () => {
    let fail = true;
    const t = setup(vi.fn(async () => { if (fail) throw new ApiError("server", "boom", 500); return {}; }));
    await t.outbox.enqueueCommand("consumption.log", log());
    await t.outbox.drain();
    fail = false;
    t.clock.t += 60_000;
    await t.outbox.enqueueCommand("consumption.edit", { consumptionLogId: ID, label: "Gin", changes: { quantity: 3 } });
    expect(await t.outbox.enqueueCommand("consumption.delete", { consumptionLogId: ID, label: "Gin" })).not.toBeNull();
    expect(t.rows().map((r) => r.type)).toEqual(["consumption.log", "consumption.delete"]); // the delete replaced the unsent edit behind the log
    await t.outbox.drain();
    expect(t.request.mock.calls.slice(1).map((c) => c[0])).toEqual(["POST", "DELETE"]);
  });

  it("describes each command for the sync list", () => {
    const { outbox } = setup();
    expect(outbox.describe({ type: "consumption.log", command: log() } as unknown as OutboxEntry<unknown>)).toBe("Usage: 0.7 L Gin");
    expect(outbox.describe({ type: "consumption.edit", command: { consumptionLogId: "c", label: "Gin", changes: {} } } as unknown as OutboxEntry<unknown>)).toBe("Change to usage entry: Gin");
    expect(outbox.describe({ type: "consumption.delete", command: { consumptionLogId: "c", label: "Gin" } } as unknown as OutboxEntry<unknown>)).toBe("Delete usage entry: Gin");
  });
});
