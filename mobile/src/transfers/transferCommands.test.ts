import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { TRANSFER_CANCEL, TRANSFER_CREATE, TRANSFER_RECEIVE, TRANSFER_SEND, transferHandlers, type TransferCreateCommand, type TransferReceiveCommand } from "./transferCommands";

const ID = "11111111-1111-4111-8111-111111111111";
const create = (over: Partial<TransferCreateCommand> = {}): TransferCreateCommand => ({
  transferId: ID,
  fromLocationId: "L1",
  fromLocationName: "Main Kitchen",
  toLocationId: "L2",
  toLocationName: "Bar",
  lines: [{ ingredientId: "i1", ingredientName: "Gin", sentQty: 2, sentUnit: "L" }],
  notes: null,
  createdAt: "2026-11-23T01:00:00.000Z",
  ...over,
});
const label = "Main Kitchen to Bar";
const receive = (over: Partial<TransferReceiveCommand> = {}): TransferReceiveCommand => ({ transferId: ID, label, userId: 1, receivedLines: [{ lineId: "l1", receivedQty: 1.5 }], hasDifference: true, ...over });

function setup(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: transferHandlers({ request } as unknown as ApiClient), now: () => 1_000_000, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, request, rows: () => [...rows.values()] };
}

describe("transfer requests", () => {
  it("creates with the phone-made id and only the fields the server takes", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand(TRANSFER_CREATE, create({ notes: "For Friday" }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/transfers", { body: { transferId: ID, fromLocationId: "L1", toLocationId: "L2", lines: [{ ingredientId: "i1", sentQty: 2, sentUnit: "L" }], notes: "For Friday" } });
  });

  it("leaves out an empty note", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand(TRANSFER_CREATE, create());
    await outbox.drain();
    expect((request.mock.calls[0][2] as { body: Record<string, unknown> }).body).not.toHaveProperty("notes");
  });

  it("sends, cancels and receives on the transfer's own routes, in the order they were saved", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand(TRANSFER_CREATE, create());
    await outbox.enqueueCommand(TRANSFER_SEND, { transferId: ID, label });
    await outbox.enqueueCommand(TRANSFER_CANCEL, { transferId: "t9", label });
    await outbox.enqueueCommand(TRANSFER_RECEIVE, receive({ transferId: "t8" }));
    await outbox.drain();
    expect(request.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["POST", "/api/inventory/transfers"],
      ["POST", `/api/inventory/transfers/${ID}/send`],
      ["POST", "/api/inventory/transfers/t9/cancel"],
      ["POST", "/api/inventory/transfers/t8/receive"],
    ]);
    expect(request.mock.calls[3][2]).toEqual({ body: { receivedLines: [{ lineId: "l1", receivedQty: 1.5 }] } });
  });

  it("describes each command for the sync list", () => {
    const { outbox } = setup();
    const d = (type: string, command: unknown) => outbox.describe({ type, command } as OutboxEntry<unknown>);
    expect(d(TRANSFER_CREATE, create())).toBe("New transfer: Main Kitchen to Bar, 1 item");
    expect(d(TRANSFER_SEND, { transferId: ID, label })).toBe("Send transfer: Main Kitchen to Bar");
    expect(d(TRANSFER_CANCEL, { transferId: ID, label })).toBe("Cancel transfer: Main Kitchen to Bar");
    expect(d(TRANSFER_RECEIVE, receive())).toBe("Receive transfer: Main Kitchen to Bar");
  });
});

describe("transfer outcomes", () => {
  const fail = async (type: string, command: unknown, err: ApiError) => {
    const t = setup(vi.fn(async () => { throw err; }));
    await t.outbox.enqueueCommand(type, command);
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("counts a send, cancel or create the server already has as done", async () => {
    expect(await fail(TRANSFER_SEND, { transferId: ID, label }, new ApiError("conflict", "Cannot send a transfer with status SENT", 409, undefined, "ALREADY_CONFIRMED"))).toMatchObject({ status: "ACCEPTED" });
    expect(await fail(TRANSFER_CANCEL, { transferId: ID, label }, new ApiError("conflict", "Only INITIATED transfers can be cancelled", 409, undefined, "ALREADY_CONFIRMED"))).toMatchObject({ status: "ACCEPTED" });
  });

  it("keeps a refusal visible with the server's words: cancelled before the send, sent before the cancel, an id that is someone else's, a location outside the organisation", async () => {
    const attention = (message: string) => ({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message } });
    expect(await fail(TRANSFER_SEND, { transferId: ID, label }, new ApiError("conflict", "Cannot send a transfer with status CANCELLED", 409, undefined, "INVALID_STATE"))).toMatchObject(attention("Cannot send a transfer with status CANCELLED"));
    expect(await fail(TRANSFER_CANCEL, { transferId: ID, label }, new ApiError("conflict", "Only INITIATED transfers can be cancelled", 409, undefined, "INVALID_STATE"))).toMatchObject(attention("Only INITIATED transfers can be cancelled"));
    expect(await fail(TRANSFER_CREATE, create(), new ApiError("conflict", "That id is already used by another transfer", 409, undefined, "CONFLICT"))).toMatchObject(attention("That id is already used by another transfer"));
    expect(await fail(TRANSFER_CREATE, create(), new ApiError("not_found", "Location not found in this organisation", 404, undefined, "NOT_FOUND"))).toMatchObject(attention("Location not found in this organisation"));
    expect(await fail(TRANSFER_CREATE, create(), new ApiError("forbidden", "You do not have access to this location", 403, undefined, "LOCATION_NOT_ALLOWED"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access" } });
  });

  it("counts a receive whose reply was lost as done: the server says it was received, by this person", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "POST") throw new ApiError("conflict", "Cannot receive a transfer with status DISCREPANCY", 409, undefined, "ALREADY_CONFIRMED");
      return { transferId: ID, fromLocationId: "L1", toLocationId: "L2", status: "DISCREPANCY", createdDttm: "2026-11-23T01:00:00.000Z", receivedByUserId: 1, lines: [] };
    });
    const t = setup(request);
    await t.outbox.enqueueCommand(TRANSFER_RECEIVE, receive());
    await t.outbox.drain();
    expect(request).toHaveBeenLastCalledWith("GET", `/api/inventory/transfers/${ID}`, expect.anything());
    expect(t.rows()[0]).toMatchObject({ status: "ACCEPTED" });
  });

  it("keeps a receive visible when someone else received the transfer first: these quantities were never saved", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "POST") throw new ApiError("conflict", "Cannot receive a transfer with status RECEIVED", 409, undefined, "ALREADY_CONFIRMED");
      return { transferId: ID, fromLocationId: "L1", toLocationId: "L2", status: "RECEIVED", createdDttm: "2026-11-23T01:00:00.000Z", receivedByUserId: 2, lines: [] };
    });
    const t = setup(request);
    await t.outbox.enqueueCommand(TRANSFER_RECEIVE, receive());
    await t.outbox.drain();
    expect(t.rows()[0]).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "Someone else received this transfer first, so these quantities were not saved. Open it to see what they recorded." } });
  });

  it("keeps a receive the server refused (a line not on the transfer, a cancelled transfer) visible", async () => {
    expect(await fail(TRANSFER_RECEIVE, receive(), new ApiError("bad_request", "A received line is not on this transfer", 400, undefined, "VALIDATION"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected" } });
    expect(await fail(TRANSFER_RECEIVE, receive(), new ApiError("conflict", "Cannot receive a transfer with status CANCELLED", 409, undefined, "INVALID_STATE"))).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected" } });
  });

  it("retries a receive whose check could not reach the server", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "POST") throw new ApiError("conflict", "Cannot receive", 409, undefined, "ALREADY_CONFIRMED");
      throw new ApiError("network");
    });
    const t = setup(request);
    await t.outbox.enqueueCommand(TRANSFER_RECEIVE, receive());
    await t.outbox.drain();
    expect(t.rows()[0]).toMatchObject({ status: "SAVED_LOCAL" });
  });
});

describe("folding before a transfer leaves the phone", () => {
  it("a cancel of a transfer that was never sent drops it: the server never hears of it", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand(TRANSFER_CREATE, create());
    expect(await outbox.enqueueCommand(TRANSFER_CANCEL, { transferId: ID, label })).toBeNull();
    expect(rows()).toHaveLength(0);
    await outbox.drain();
    expect(request).not.toHaveBeenCalled();
  });

  it("a cancel after a create that may be on the server goes after it", async () => {
    const { outbox, request, rows } = setup(vi.fn().mockRejectedValueOnce(new ApiError("timeout")).mockResolvedValue({}));
    await outbox.enqueueCommand(TRANSFER_CREATE, create());
    await outbox.drain();
    await outbox.enqueueCommand(TRANSFER_CANCEL, { transferId: ID, label });
    expect(rows()).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("discarding the create discards the send queued after it", async () => {
    const { outbox, rows } = setup(vi.fn(async () => { throw new ApiError("conflict", "That id is already used by another transfer", 409, undefined, "CONFLICT"); }));
    const created = await outbox.enqueueCommand(TRANSFER_CREATE, create());
    await outbox.enqueueCommand(TRANSFER_SEND, { transferId: ID, label });
    await outbox.drain();
    await outbox.discard(created!.id);
    expect(rows().map((r) => r.status)).toEqual(["DISCARDED", "DISCARDED"]);
  });
});
