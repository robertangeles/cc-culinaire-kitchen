/**
 * The three offline waste commands and what the server's answers to them mean. All of them are safe to send twice:
 * the log carries its own id (`wasteLogId`, made on the phone), an edit is a partial update, and the server answers a
 * repeat of a delete with success (an older server answers 404, which also means done).
 *
 * Commands about one entry share the key `waste:<id>` so they are sent in the order they were saved, and a change made
 * before the log has left the phone is folded into the log (an edit becomes the log's final values; a delete of an
 * unsent log cancels it: the server never hears of an entry that never left the phone).
 */

import { ApiError, type ApiClient } from "../api/client";
import type { CommandHandler, Outcome } from "../outbox/outbox";

export interface WasteLogCommand {
  /** Made on the phone; the server stores the row under it. */
  wasteLogId: string;
  /** Where the entry was made: a log sent after a location switch still lands here. */
  storeLocationId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  reason: string | null;
  shift: string | null;
  estimatedCost: number | null;
  notes: string | null;
  /** ISO, the phone's clock when the entry was made. */
  loggedAt: string;
}

/** The fields an edit may change; `null` clears one. */
export type WasteChanges = Partial<Pick<WasteLogCommand, "ingredientName" | "quantity" | "unit" | "reason" | "shift" | "estimatedCost" | "notes">>;

export interface WasteEditCommand {
  wasteLogId: string;
  /** The entry's name, for the sync list. */
  label: string;
  changes: WasteChanges;
}

export interface WasteDeleteCommand {
  wasteLogId: string;
  label: string;
}

export const WASTE_LOG = "waste.log";
export const WASTE_EDIT = "waste.edit";
export const WASTE_DELETE = "waste.delete";
export const WASTE_TYPES = [WASTE_LOG, WASTE_EDIT, WASTE_DELETE];

const MAX_SERVER_FAILURES = 5;
const key = (c: { wasteLogId: string }) => `waste:${c.wasteLogId}`;

type Open = { type: string; command: unknown };

/** What saving `incoming` means when an unsent command about the same entry is waiting. */
function fold(open: Open, incoming: WasteLogCommand | WasteEditCommand | WasteDeleteCommand, mayBeOnServer: boolean): Open | "cancel" | "append" {
  if (mayBeOnServer) return "append"; // the server may already hold it (a replay answers with the old row): the change goes after it
  const isEdit = "changes" in incoming;
  const isDelete = !isEdit && !("quantity" in incoming);
  if (isDelete) return open.type === WASTE_LOG ? "cancel" : { type: WASTE_DELETE, command: incoming };
  if (!isEdit) return "append"; // a log has a new id, so there is nothing to fold into
  if (open.type === WASTE_LOG) return { type: WASTE_LOG, command: { ...(open.command as WasteLogCommand), ...incoming.changes } };
  if (open.type === WASTE_EDIT) return { type: WASTE_EDIT, command: { ...incoming, changes: { ...(open.command as WasteEditCommand).changes, ...incoming.changes } } };
  return "append";
}

const refused = (err: ApiError): Outcome => ({ kind: "attention", reason: "rejected", message: err.message });

/** A log sent with a location the person no longer works at is 403 LOCATION_NOT_ALLOWED: the default "no access" reading, with the server's words. */
const classifyLog = (err: ApiError): Outcome | undefined => (err.hasCode("CONFLICT") ? refused(err) : undefined);

export function wasteHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const log: CommandHandler<WasteLogCommand> = {
    type: WASTE_LOG,
    version: 1,
    key,
    creates: true,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    classify: classifyLog,
    async send(c) {
      const body = { wasteLogId: c.wasteLogId, storeLocationId: c.storeLocationId, ingredientName: c.ingredientName, quantity: c.quantity, unit: c.unit, loggedAt: c.loggedAt } as Record<string, unknown>;
      if (c.reason) body.reason = c.reason;
      if (c.shift) body.shift = c.shift;
      if (c.estimatedCost !== null) body.estimatedCost = c.estimatedCost;
      if (c.notes) body.notes = c.notes;
      await client.request("POST", "/api/waste", { body });
    },
    describe: (c) => `Waste: ${c.quantity} ${c.unit} ${c.ingredientName}`,
  };
  const edit: CommandHandler<WasteEditCommand> = {
    type: WASTE_EDIT,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    async send(c) {
      await client.request("PATCH", `/api/waste/${encodeURIComponent(c.wasteLogId)}`, { body: c.changes });
    },
    describe: (c) => `Change to waste entry: ${c.label}`,
  };
  const remove: CommandHandler<WasteDeleteCommand> = {
    type: WASTE_DELETE,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    isApplied: (err) => err.code === "not_found",
    async send(c) {
      await client.request("DELETE", `/api/waste/${encodeURIComponent(c.wasteLogId)}`, {});
    },
    describe: (c) => `Delete waste entry: ${c.label}`,
  };
  return [log, edit, remove] as CommandHandler<unknown>[];
}
