/**
 * The three offline consumption commands and what the server's answers to them mean. All are safe to send twice: the log
 * carries its own id (`consumptionLogId`, made on the phone; a repeat answers 200 with the stored row and takes no more stock),
 * an edit sets absolute values, and the server answers a repeat of a delete with success (an older server answers 404, which also means done).
 *
 * Commands about one entry share the key `consumption:<id>` so they are sent in the order saved, and a change made before the log
 * has left the phone is folded into the log (an edit becomes the log's final values; a delete of an unsent log cancels it).
 * The server stamps `loggedAt` when the log arrives (the route takes no time), so an entry sent hours late shows the later time once it is on the server.
 */

import type { ApiClient, ApiError } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";

export interface ConsumptionLogCommand {
  consumptionLogId: string;
  /** Where the entry was made: a log sent after a location switch still lands here. */
  storeLocationId: string;
  ingredientId: string;
  /** For the list and the sync line; the server has the name from `ingredientId`. */
  ingredientName: string;
  quantity: number;
  /** The item's kitchen unit. */
  unit: string;
  /** A key of `CONSUMPTION_REASONS`. */
  reason: string;
  shift: string | null;
  notes: string | null;
  /** ISO, the phone's clock when made: what the list shows until the server's own list holds the entry. Not sent. */
  loggedAt: string;
}

/** What an edit may change; `null` clears a shift or notes. The reason is required, so it can be changed but never cleared. */
export type ConsumptionChanges = Partial<Pick<ConsumptionLogCommand, "quantity" | "reason" | "shift" | "notes">>;

export interface ConsumptionEditCommand {
  consumptionLogId: string;
  label: string;
  changes: ConsumptionChanges;
}

export interface ConsumptionDeleteCommand {
  consumptionLogId: string;
  label: string;
}

export const CONSUMPTION_LOG = "consumption.log";
export const CONSUMPTION_EDIT = "consumption.edit";
export const CONSUMPTION_DELETE = "consumption.delete";
export const CONSUMPTION_TYPES = [CONSUMPTION_LOG, CONSUMPTION_EDIT, CONSUMPTION_DELETE];

const MAX_SERVER_FAILURES = 5;
const key = (c: { consumptionLogId: string }) => `consumption:${c.consumptionLogId}`;

type Open = { type: string; command: unknown };

/** What saving `incoming` means when an unsent command about the same entry is waiting. */
function fold(open: Open, incoming: ConsumptionLogCommand | ConsumptionEditCommand | ConsumptionDeleteCommand, mayBeOnServer: boolean): Open | "cancel" | "append" {
  if (mayBeOnServer) return "append"; // the server may already hold it (a replay answers with the old row): the change goes after it
  const isEdit = "changes" in incoming;
  const isDelete = !isEdit && !("quantity" in incoming);
  if (isDelete) return open.type === CONSUMPTION_LOG ? "cancel" : { type: CONSUMPTION_DELETE, command: incoming };
  if (!isEdit) return "append"; // a log has a new id, so there is nothing to fold into
  if (open.type === CONSUMPTION_LOG) return { type: CONSUMPTION_LOG, command: { ...(open.command as ConsumptionLogCommand), ...incoming.changes } };
  if (open.type === CONSUMPTION_EDIT) return { type: CONSUMPTION_EDIT, command: { ...incoming, changes: { ...(open.command as ConsumptionEditCommand).changes, ...incoming.changes } } };
  return "append";
}

export function consumptionHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const log: CommandHandler<ConsumptionLogCommand> = {
    type: CONSUMPTION_LOG,
    version: 1,
    key,
    creates: true,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    // A 409 CONFLICT (the id is another person's), a 403 LOCATION_NOT_ALLOWED and a 422 INCOMPATIBLE_UNITS are refusals the default reading keeps visible, with the server's words.
    async send(c) {
      const body: Record<string, unknown> = { consumptionLogId: c.consumptionLogId, storeLocationId: c.storeLocationId, ingredientId: c.ingredientId, quantity: c.quantity, unit: c.unit, reason: c.reason };
      if (c.shift) body.shift = c.shift;
      if (c.notes) body.notes = c.notes;
      await client.request("POST", "/api/inventory/consumption-logs", { body });
    },
    describe: (c) => `Usage: ${c.quantity} ${c.unit} ${c.ingredientName}`,
  };
  const edit: CommandHandler<ConsumptionEditCommand> = {
    type: CONSUMPTION_EDIT,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    async send(c) {
      await client.request("PATCH", `/api/inventory/consumption-logs/${encodeURIComponent(c.consumptionLogId)}`, { body: c.changes });
    },
    describe: (c) => `Change to usage entry: ${c.label}`,
  };
  const remove: CommandHandler<ConsumptionDeleteCommand> = {
    type: CONSUMPTION_DELETE,
    version: 1,
    key,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold,
    isApplied: (err: ApiError) => err.code === "not_found",
    async send(c) {
      await client.request("DELETE", `/api/inventory/consumption-logs/${encodeURIComponent(c.consumptionLogId)}`, {});
    },
    describe: (c) => `Delete usage entry: ${c.label}`,
  };
  return [log, edit, remove] as CommandHandler<unknown>[];
}
