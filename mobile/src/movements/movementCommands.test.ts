import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { movementHandlers, type MovementLogCommand } from "./movementCommands";

const move = (over: Partial<MovementLogCommand> = {}): MovementLogCommand => ({
  stockMovementId: "11111111-1111-4111-8111-111111111111",
  storeLocationId: "L1",
  ingredientId: "i1",
  ingredientName: "Gin",
  fromStorageAreaId: "a1",
  fromAreaName: "Stock Room",
  toStorageAreaId: "a2",
  toAreaName: "Bar",
  quantity: 4,
  unit: "bottle",
  notes: null,
  movedAt: "2026-11-23T01:00:00.000Z",
  ...over,
});

function setup(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: movementHandlers({ request } as unknown as ApiClient), now: () => 1_000_000, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, request, rows: () => [...rows.values()] };
}

describe("stock movement requests", () => {
  it("sends a move to the location it was made at, with its client-made id and without the phone-only fields", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("movement.log", move({ notes: "Friday service" }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/locations/L1/stock-movements", { body: { stockMovementId: "11111111-1111-4111-8111-111111111111", ingredientId: "i1", fromStorageAreaId: "a1", toStorageAreaId: "a2", quantity: 4, unit: "bottle", notes: "Friday service" } });
  });

  it("leaves out a note that was not filled in", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("movement.log", move());
    await outbox.drain();
    expect((request.mock.calls[0][2] as { body: Record<string, unknown> }).body).not.toHaveProperty("notes");
  });

  it("describes the move for the sync list", () => {
    const { outbox } = setup();
    expect(outbox.describe({ type: "movement.log", command: move() } as unknown as OutboxEntry<unknown>)).toBe("Move: 4 bottle Gin, Stock Room to Bar");
  });
});

describe("stock movement outcomes", () => {
  const fail = async (err: ApiError) => {
    const t = setup(vi.fn(async () => { throw err; }));
    await t.outbox.enqueueCommand("movement.log", move());
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("keeps each refusal visible with the server's words: an area at another location, an area no longer in use, units that cannot be converted, an id that is someone else's", async () => {
    expect(await fail(new ApiError("not_found", "That 'from' area isn't at this location", 404, undefined, "NOT_FOUND"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "That 'from' area isn't at this location" } });
    expect((await fail(new ApiError("bad_request", "That area is no longer in use", 400, undefined, "VALIDATION"))).status).toBe("NEEDS_ATTENTION");
    expect((await fail(new ApiError("bad_request", "Cannot convert bottle to kg", 422, undefined, "INCOMPATIBLE_UNITS"))).status).toBe("NEEDS_ATTENTION");
    expect((await fail(new ApiError("conflict", "That id is already used", 409, undefined, "CONFLICT"))).status).toBe("NEEDS_ATTENTION");
    expect((await fail(new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"))).attention?.reason).toBe("no_access");
  });

  it("retries a server failure, and stops after five tries to ask the person", () => {
    expect(movementHandlers({} as ApiClient)[0].maxServerFailures).toBe(5);
  });
});
