import { describe, it, expect } from "vitest";
import type { TransferSummary } from "@culinaire/shared/schemas/transfer";
import type { OutboxEntry } from "../outbox/outbox";
import { TRANSFER_CANCEL, TRANSFER_CREATE, TRANSFER_RECEIVE, TRANSFER_SEND, type TransferCreateCommand } from "./transferCommands";
import { checkReceipt, groupTransfers, mergeTransfers, statusWords } from "./transferView";

const server = (over: Partial<TransferSummary> = {}): TransferSummary => ({ transferId: "t1", fromLocationId: "L1", toLocationId: "L2", status: "INITIATED", notes: null, sentDttm: null, receivedDttm: null, createdDttm: "2026-11-23T08:00:00.000Z", fromLocationName: "Main", toLocationName: "Bar", initiatorName: "Sam", lineCount: 2, ...over });
const create: TransferCreateCommand = { transferId: "t9", fromLocationId: "L1", fromLocationName: "Main", toLocationId: "L2", toLocationName: "Bar", lines: [{ ingredientId: "i1", ingredientName: "Gin", sentQty: 2, sentUnit: "L" }], notes: null, createdAt: "2026-11-23T09:00:00.000Z" };
let n = 0;
const entry = (type: string, command: unknown, status: OutboxEntry["status"] = "SAVED_LOCAL", message?: string) => ({ id: `e${++n}`, userId: 1, type, version: 1, status, command, attempts: 0, serverFailures: 0, nextAttemptAt: 0, createdAt: n, updatedAt: n, ...(message ? { attention: { reason: "rejected", message } } : {}) }) as OutboxEntry<unknown>;

describe("the transfer list", () => {
  it("adds a transfer made on this phone that the server does not hold yet, newest first", () => {
    const rows = mergeTransfers([server()], [entry(TRANSFER_CREATE, create)], "Cook");
    expect(rows.map((r) => [r.transferId, r.status, r.sync, r.lineCount, r.initiatorName])).toEqual([["t9", "INITIATED", "waiting", 1, "Cook"], ["t1", "INITIATED", "synced", 2, "Sam"]]);
  });

  it("shows a send, cancel or receive still on the phone as done, waiting to send", () => {
    const rows = mergeTransfers(
      [server(), server({ transferId: "t2" }), server({ transferId: "t3", status: "SENT", fromLocationId: "L2", toLocationId: "L1" })],
      [entry(TRANSFER_SEND, { transferId: "t1", label: "" }), entry(TRANSFER_CANCEL, { transferId: "t2", label: "" }), entry(TRANSFER_RECEIVE, { transferId: "t3", label: "", userId: 1, receivedLines: [], hasDifference: true })],
      "Cook",
    );
    expect(rows.map((r) => [r.transferId, r.status, r.sync, r.pending])).toEqual([["t1", "SENT", "waiting", "send"], ["t2", "CANCELLED", "waiting", "cancel"], ["t3", "DISCREPANCY", "waiting", "receive"]]);
  });

  it("keeps what the server holds when it refused the change, with its words and the entry to retry or discard", () => {
    const send = entry(TRANSFER_SEND, { transferId: "t1", label: "" }, "NEEDS_ATTENTION", "Cannot send a transfer with status CANCELLED");
    const [row] = mergeTransfers([server()], [send], "Cook");
    expect(row).toMatchObject({ status: "INITIATED", sync: "attention", entryId: send.id, attentionMessage: "Cannot send a transfer with status CANCELLED", pending: "send" });
  });

  it("keeps a refused new transfer on the list", () => {
    const e = entry(TRANSFER_CREATE, create, "NEEDS_ATTENTION", "That id is already used by another transfer");
    expect(mergeTransfers([], [e], "Cook")[0]).toMatchObject({ transferId: "t9", sync: "attention", entryId: e.id });
  });

  it("forgets what was sent and discarded: the server's row is the truth", () => {
    const rows = mergeTransfers([server({ status: "SENT" })], [entry(TRANSFER_SEND, { transferId: "t1", label: "" }, "ACCEPTED"), entry(TRANSFER_CREATE, create, "DISCARDED")], "Cook");
    expect(rows).toEqual([expect.objectContaining({ transferId: "t1", status: "SENT", sync: "synced" })]);
  });

  it("groups by what this location has to do: receive what is on its way here, then what it sent, then what it received", () => {
    const rows = mergeTransfers([server({ transferId: "out" }), server({ transferId: "in", fromLocationId: "L2", toLocationId: "L1", status: "RECEIVED" }), server({ transferId: "due", fromLocationId: "L2", toLocationId: "L1", status: "SENT" })], [], "Cook");
    const g = groupTransfers(rows, "L1");
    expect([g.toReceive, g.outgoing, g.incoming].map((list) => list.map((r) => r.transferId))).toEqual([["due"], ["out"], ["in"]]);
  });

  it("names every status in words, and an unknown one as it came", () => {
    expect(["INITIATED", "SENT", "RECEIVED", "DISCREPANCY", "CANCELLED", "ON_HOLD"].map(statusWords)).toEqual(["Not sent yet", "On its way", "Received", "Received with differences", "Cancelled", "ON_HOLD"]);
  });
});

describe("checking a receipt", () => {
  const lines = [{ lineId: "l1", sentQty: 2, sentUnit: "L" }, { lineId: "l2", sentQty: 1.5, sentUnit: "kg" }];

  it("takes what was sent for a line left as it was", () => {
    expect(checkReceipt(lines, {})).toEqual({ ok: true, receivedLines: [{ lineId: "l1", receivedQty: 2 }, { lineId: "l2", receivedQty: 1.5 }], differences: [] });
  });

  it("names each line that differs from what was sent, short or over, and accepts 0 for a line that never came", () => {
    const r = checkReceipt(lines, { l1: "0", l2: "1,75" });
    expect(r).toMatchObject({ ok: true, receivedLines: [{ lineId: "l1", receivedQty: 0 }, { lineId: "l2", receivedQty: 1.75 }] });
    expect(r).toMatchObject({ differences: [{ lineId: "l1", difference: -2 }, { lineId: "l2", difference: 0.25 }] });
  });

  it("ignores a difference within the server's tolerance", () => {
    expect(checkReceipt(lines, { l1: "2.0005" })).toMatchObject({ ok: true, differences: [] });
  });

  it("refuses a quantity the server would refuse: below 0 or not a number", () => {
    expect(checkReceipt(lines, { l1: "-1" })).toEqual({ ok: false, lineId: "l1", message: "Enter what arrived: 0 or more." });
    expect(checkReceipt(lines, { l2: "abc" })).toEqual({ ok: false, lineId: "l2", message: "Enter what arrived: 0 or more." });
    expect(checkReceipt(lines, { l1: "100000" })).toMatchObject({ ok: true }); // no upper limit on the server
  });
});
