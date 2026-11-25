import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { CATALOG_REQUEST, catalogRequestHandlers, type CatalogRequestCommand } from "./catalogRequestCommands";

const request = (over: Partial<CatalogRequestCommand> = {}): CatalogRequestCommand => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  storeLocationId: "L1",
  itemName: "Yuzu juice",
  itemType: "KITCHEN_INGREDIENT",
  category: "beverages",
  baseUnit: "L",
  countedQty: null,
  requestedAt: "2026-11-23T01:00:00.000Z",
  ...over,
});

function setup(send: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()], put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: catalogRequestHandlers({ request: send } as unknown as ApiClient), now: () => 1_000_000, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, send, rows: () => [...rows.values()] };
}

describe("catalogue requests", () => {
  it("sends the phone-made id, the location it was asked at and only what was filled in", async () => {
    const { outbox, send } = setup();
    await outbox.enqueueCommand(CATALOG_REQUEST, request());
    await outbox.enqueueCommand(CATALOG_REQUEST, request({ requestId: "22222222-2222-4222-8222-222222222222", itemType: null, category: null, baseUnit: null, countedQty: 3 }));
    await outbox.drain();
    expect(send.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      ["POST", "/api/inventory/catalog-requests", { body: { requestId: "11111111-1111-4111-8111-111111111111", storeLocationId: "L1", itemName: "Yuzu juice", itemType: "KITCHEN_INGREDIENT", category: "beverages", baseUnit: "L" } }],
      ["POST", "/api/inventory/catalog-requests", { body: { requestId: "22222222-2222-4222-8222-222222222222", storeLocationId: "L1", itemName: "Yuzu juice", countedQty: 3 } }],
    ]);
  });

  it("keeps a refusal visible: an id that is someone else's, a location the person does not work at", async () => {
    for (const err of [new ApiError("conflict", "That id is already used by another request", 409, undefined, "CONFLICT"), new ApiError("forbidden", "You do not have access to this location", 403, undefined, "LOCATION_NOT_ALLOWED")]) {
      const t = setup(vi.fn(async () => { throw err; }));
      await t.outbox.enqueueCommand(CATALOG_REQUEST, request());
      await t.outbox.drain();
      expect(t.rows()[0]).toMatchObject({ status: "NEEDS_ATTENTION", attention: { message: err.message } });
    }
  });

  it("describes the request for the sync list", () => {
    const { outbox } = setup();
    expect(outbox.describe({ type: CATALOG_REQUEST, command: request() } as OutboxEntry<unknown>)).toBe("New item request: Yuzu juice");
  });
});
