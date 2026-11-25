/**
 * The four offline transfer commands. Each is safe to send twice (CHANGELOG, mobile Wave 3 server): create carries its own id
 * (`transferId`, made on the phone) and a repeat answers 200 with the stored transfer; send, cancel and receive lock the transfer
 * and refuse a second go with 409 `ALREADY_CONFIRMED`, so stock moves once.
 *
 * Commands about one transfer share the key `transfer:<id>` and are sent in the order saved. A cancel of a transfer that never left
 * the phone drops it. A receive the server says is already done is only "done" if this person did it: when someone else received
 * the transfer first, these quantities were never saved, and that stays on screen.
 */

import { TransferDetailSchema } from "@culinaire/shared/schemas/transfer";
import { ApiError, type ApiClient } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";

export interface TransferLineInput {
  ingredientId: string;
  ingredientName: string;
  sentQty: number;
  /** The item's kitchen unit. */
  sentUnit: string;
}

export interface TransferCreateCommand {
  transferId: string;
  /** Where it was made: stock leaves this location. */
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  lines: TransferLineInput[];
  notes: string | null;
  /** ISO, the phone's clock: what the list shows until the server holds the transfer. Not sent. */
  createdAt: string;
}

/** Send and cancel: the transfer, and "Main Kitchen to Bar" for the sync list. */
export interface TransferActionCommand {
  transferId: string;
  label: string;
}

export interface TransferReceiveCommand {
  transferId: string;
  label: string;
  /** Who received it, to tell a lost reply of their own receive from someone else's. */
  userId: number;
  /** Every line, with what arrived in the line's unit (0 for a line that never came). */
  receivedLines: { lineId: string; receivedQty: number }[];
  /** Some line differs from what was sent: the list shows "with differences" until the server's answer is in. Not sent. */
  hasDifference: boolean;
}

export const TRANSFER_CREATE = "transfer.create";
export const TRANSFER_SEND = "transfer.send";
export const TRANSFER_CANCEL = "transfer.cancel";
export const TRANSFER_RECEIVE = "transfer.receive";
export const TRANSFER_TYPES = [TRANSFER_CREATE, TRANSFER_SEND, TRANSFER_CANCEL, TRANSFER_RECEIVE];

const MAX_SERVER_FAILURES = 5;
const key = (c: { transferId: string }) => `transfer:${c.transferId}`;
const route = (id: string, action: string) => `/api/inventory/transfers/${encodeURIComponent(id)}/${action}`;
const alreadyDone = (err: ApiError) => err.hasCode("ALREADY_CONFIRMED");
const SOMEONE_ELSE = "Someone else received this transfer first, so these quantities were not saved. Open it to see what they recorded.";

export function transferHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const create: CommandHandler<TransferCreateCommand> = {
    type: TRANSFER_CREATE,
    version: 1,
    key,
    creates: true,
    maxServerFailures: MAX_SERVER_FAILURES,
    // 409 CONFLICT (an id that is someone else's), 404 NOT_FOUND (a location or item outside the organisation) and 403 are refusals the default reading keeps visible.
    async send(c) {
      const body: Record<string, unknown> = { transferId: c.transferId, fromLocationId: c.fromLocationId, toLocationId: c.toLocationId, lines: c.lines.map(({ ingredientId, sentQty, sentUnit }) => ({ ingredientId, sentQty, sentUnit })) };
      if (c.notes) body.notes = c.notes;
      await client.request("POST", "/api/inventory/transfers", { body });
    },
    describe: (c) => `New transfer: ${c.fromLocationName} to ${c.toLocationName}, ${c.lines.length} ${c.lines.length === 1 ? "item" : "items"}`,
  };
  const send: CommandHandler<TransferActionCommand> = {
    type: TRANSFER_SEND,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    // Already sent (by anyone) is the outcome asked for: the stock left once. A cancelled transfer is INVALID_STATE, kept visible.
    isApplied: alreadyDone,
    async send(c) {
      await client.request("POST", route(c.transferId, "send"), {});
    },
    describe: (c) => `Send transfer: ${c.label}`,
  };
  const cancel: CommandHandler<TransferActionCommand> = {
    type: TRANSFER_CANCEL,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    isApplied: alreadyDone,
    // Never sent: the server never hears of it. Otherwise it goes after what may already be there.
    fold: (open, _incoming, mayBeOnServer) => (!mayBeOnServer && open.type === TRANSFER_CREATE ? "cancel" : "append"),
    async send(c) {
      await client.request("POST", route(c.transferId, "cancel"), {});
    },
    describe: (c) => `Cancel transfer: ${c.label}`,
  };
  const receive: CommandHandler<TransferReceiveCommand> = {
    type: TRANSFER_RECEIVE,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    async send(c) {
      try {
        await client.request("POST", route(c.transferId, "receive"), { body: { receivedLines: c.receivedLines } });
      } catch (err) {
        if (!(err instanceof ApiError) || !alreadyDone(err)) throw err;
        const stored = await client.request("GET", `/api/inventory/transfers/${encodeURIComponent(c.transferId)}`, { schema: TransferDetailSchema });
        if (stored.receivedByUserId === c.userId) return; // this person's own receive, whose reply was lost
        throw new ApiError("conflict", SOMEONE_ELSE, 409, undefined, "ALREADY_CONFIRMED");
      }
    },
    describe: (c) => `Receive transfer: ${c.label}`,
  };
  return [create, send, cancel, receive] as CommandHandler<unknown>[];
}
