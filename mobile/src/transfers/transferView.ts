/** What the transfer screens show: the server's transfers with the commands still on the phone laid over them. Pure functions. */

import type { TransferSummary } from "@culinaire/shared/schemas/transfer";
import type { OutboxEntry } from "../outbox/outbox";
import { OPEN, type RowSync } from "../waste/wasteView";
import { TRANSFER_CANCEL, TRANSFER_CREATE, TRANSFER_RECEIVE, TRANSFER_SEND, type TransferCreateCommand, type TransferReceiveCommand } from "./transferCommands";

export type PendingAction = "create" | "send" | "cancel" | "receive";

export type TransferRow = Omit<TransferSummary, "notes"> & {
  notes: string | null;
  sync: RowSync;
  /** The newest change still on the phone. */
  pending?: PendingAction;
  /** The queue entry the server refused, for Try again and Discard. */
  entryId?: string;
  attentionMessage?: string;
};

const ACTION: Record<string, PendingAction> = { [TRANSFER_CREATE]: "create", [TRANSFER_SEND]: "send", [TRANSFER_CANCEL]: "cancel", [TRANSFER_RECEIVE]: "receive" };

function fromCreate(c: TransferCreateCommand, userName: string): TransferRow {
  return { transferId: c.transferId, fromLocationId: c.fromLocationId, toLocationId: c.toLocationId, fromLocationName: c.fromLocationName, toLocationName: c.toLocationName, status: "INITIATED", notes: c.notes, sentDttm: null, receivedDttm: null, createdDttm: c.createdAt, initiatorName: userName, lineCount: c.lines.length, sync: "synced" };
}

/**
 * The server's transfers and this account's queued changes, newest first. `entries` are oldest first, as the outbox lists them.
 * A waiting change shows its result (a send shows "On its way"); a refused one leaves the server's status and carries the server's words.
 */
export function mergeTransfers(serverRows: TransferSummary[], entries: OutboxEntry<unknown>[], userName: string): TransferRow[] {
  const rows = new Map<string, TransferRow>(serverRows.map((s) => [s.transferId, { ...s, sync: "synced" }]));
  for (const e of entries) {
    const action = ACTION[e.type];
    if (!action || !OPEN.includes(e.status)) continue;
    const id = (e.command as { transferId: string }).transferId;
    const row = rows.get(id) ?? (action === "create" ? fromCreate(e.command as TransferCreateCommand, userName) : undefined);
    if (!row) continue; // a change to a transfer this list does not hold (an older one): nothing to show it on
    const refused = e.status === "NEEDS_ATTENTION";
    const status = refused ? row.status : action === "send" ? "SENT" : action === "cancel" ? "CANCELLED" : action === "receive" ? ((e.command as TransferReceiveCommand).hasDifference ? "DISCREPANCY" : "RECEIVED") : row.status;
    rows.set(id, {
      ...row,
      status,
      pending: action,
      // A refusal outweighs a later waiting change: the person must see it.
      sync: refused || row.sync === "attention" ? "attention" : "waiting",
      ...(refused ? { entryId: e.id, attentionMessage: e.attention?.message } : {}),
    });
  }
  return [...rows.values()].sort((a, b) => (a.createdDttm < b.createdDttm ? 1 : a.createdDttm > b.createdDttm ? -1 : 0));
}

/** What this location has to do first: receive what is on its way here; then what it sent; then what it received. */
export function groupTransfers(rows: TransferRow[], locationId: string) {
  const toReceive = rows.filter((r) => r.toLocationId === locationId && r.status === "SENT");
  return {
    toReceive,
    outgoing: rows.filter((r) => r.fromLocationId === locationId),
    incoming: rows.filter((r) => r.toLocationId === locationId && !toReceive.includes(r)),
  };
}

/** "23 Nov, 10:00" in the phone's own words. */
export const dayAndTime = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const WORDS: Record<string, string> = { INITIATED: "Not sent yet", SENT: "On its way", RECEIVED: "Received", DISCREPANCY: "Received with differences", CANCELLED: "Cancelled" };
export const statusWords = (status: string) => WORDS[status] ?? status;

/** The server's own limits: a quantity it refuses is caught here, and so is its tolerance for "the same as sent". */
const MAX_QTY = 99999;
const TOLERANCE = 0.001;

export type ReceiptCheck =
  | { ok: true; receivedLines: { lineId: string; receivedQty: number }[]; differences: { lineId: string; difference: number }[] }
  | { ok: false; lineId: string; message: string };

/** What arrived, line by line: `typed` holds what the person changed ("" or absent = as sent). A difference is received minus sent. */
export function checkReceipt(lines: { lineId: string; sentQty: number }[], typed: Record<string, string>): ReceiptCheck {
  const receivedLines: { lineId: string; receivedQty: number }[] = [];
  const differences: { lineId: string; difference: number }[] = [];
  for (const line of lines) {
    const text = (typed[line.lineId] ?? "").trim();
    const qty = text === "" ? line.sentQty : Number(text.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) return { ok: false, lineId: line.lineId, message: "Enter what arrived: 0 or more." };
    if (qty > MAX_QTY) return { ok: false, lineId: line.lineId, message: "That's more than the app can record for one item." };
    receivedLines.push({ lineId: line.lineId, receivedQty: qty });
    if (Math.abs(qty - line.sentQty) > TOLERANCE) differences.push({ lineId: line.lineId, difference: Math.round((qty - line.sentQty) * 1000) / 1000 });
  }
  return { ok: true, receivedLines, differences };
}
