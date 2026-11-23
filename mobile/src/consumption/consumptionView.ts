/**
 * What the usage screen shows: the server's entries for today with the commands still on the phone laid over them, so an entry made
 * offline is on the list at once and an edit or delete shows before it is sent. Pure functions.
 */

import { FOH_MOVE_ITEM_TYPES, RETURN_TO_STOCK, type ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import type { OutboxEntry } from "../outbox/outbox";
import { OPEN, syncOf, type RowSync } from "../waste/wasteView";
import { CONSUMPTION_DELETE, CONSUMPTION_EDIT, CONSUMPTION_LOG, type ConsumptionDeleteCommand, type ConsumptionEditCommand, type ConsumptionLogCommand } from "./consumptionCommands";

export interface ConsumptionRow {
  consumptionLogId: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  reason: string;
  shift: string | null;
  notes: string | null;
  loggedAt: string;
  userId: number;
  userName: string | null;
  sync: RowSync;
  /** The queue entry that is waiting or stuck for this row, for retry and discard. */
  entryId?: string;
  attentionMessage?: string;
}

/** Who is looking: their entries are the ones they can change (an Administrator may change anyone's, as on the server). */
export interface Viewer {
  userId: number;
  userName: string;
  isAdmin: boolean;
}

export const canChange = (row: ConsumptionRow, viewer: Viewer) => viewer.isAdmin || row.userId === viewer.userId;

function fromLog(c: ConsumptionLogCommand, e: OutboxEntry<unknown>, who: Viewer): ConsumptionRow {
  return { consumptionLogId: c.consumptionLogId, ingredientId: c.ingredientId, ingredientName: c.ingredientName, quantity: c.quantity, unit: c.unit, reason: c.reason, shift: c.shift, notes: c.notes, loggedAt: c.loggedAt, userId: who.userId, userName: who.userName, sync: syncOf(e), ...(e.status === "NEEDS_ATTENTION" ? { entryId: e.id, attentionMessage: e.attention?.message } : OPEN.includes(e.status) ? { entryId: e.id } : {}) };
}

/** The server's entries and this account's queue entries, for one day, newest first. `entries` are oldest first, as the outbox lists them. */
export function mergeConsumption(serverRows: ConsumptionEntry[], entries: OutboxEntry<unknown>[], day: { start: string; end: string }, who: Viewer): ConsumptionRow[] {
  const rows = new Map<string, ConsumptionRow>();
  for (const s of serverRows) rows.set(s.consumptionLogId, { ...s, sync: "synced" });

  for (const e of entries) {
    if (e.type === CONSUMPTION_LOG) {
      const c = e.command as ConsumptionLogCommand;
      if (!rows.has(c.consumptionLogId) || OPEN.includes(e.status)) rows.set(c.consumptionLogId, fromLog(c, e, who));
    } else if (e.type === CONSUMPTION_EDIT) {
      const c = e.command as ConsumptionEditCommand;
      const row = rows.get(c.consumptionLogId);
      if (!row || !OPEN.includes(e.status)) continue;
      rows.set(c.consumptionLogId, { ...row, ...c.changes, sync: e.status === "NEEDS_ATTENTION" || row.sync === "attention" ? "attention" : "waiting", entryId: row.entryId ?? e.id, ...(e.status === "NEEDS_ATTENTION" ? { entryId: e.id, attentionMessage: e.attention?.message } : {}) });
    } else if (e.type === CONSUMPTION_DELETE) {
      const c = e.command as ConsumptionDeleteCommand;
      const row = rows.get(c.consumptionLogId);
      if (!row) continue;
      if (e.status === "ACCEPTED") {
        rows.delete(c.consumptionLogId);
        continue;
      }
      if (!OPEN.includes(e.status)) continue;
      // A delete waiting to be sent hides the entry (the person has deleted it); a refused one brings it back with the reason.
      if (e.status === "NEEDS_ATTENTION") rows.set(c.consumptionLogId, { ...row, sync: "attention", entryId: e.id, attentionMessage: e.attention?.message });
      else rows.delete(c.consumptionLogId);
    }
  }

  return [...rows.values()].filter((r) => r.loggedAt >= day.start && r.loggedAt <= day.end).sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : a.loggedAt > b.loggedAt ? -1 : 0));
}

export interface UnitTotal {
  unit: string;
  quantity: number;
}
export interface DayTotals {
  entries: number;
  /** Taken out of stock, one line per unit, biggest first: litres and bunches are never added together. */
  used: UnitTotal[];
  /** Put back ("Return to Stockroom"), kept apart so it is never counted as usage. */
  returned: UnitTotal[];
}

const byUnit = (rows: ConsumptionRow[]): UnitTotal[] => {
  const units = new Map<string, number>();
  for (const r of rows) units.set(r.unit, (units.get(r.unit) ?? 0) + r.quantity);
  return [...units].map(([unit, quantity]) => ({ unit, quantity: Math.round(quantity * 1000) / 1000 })).sort((a, b) => b.quantity - a.quantity);
};

export const dayTotals = (rows: ConsumptionRow[]): DayTotals => ({
  entries: rows.length,
  used: byUnit(rows.filter((r) => r.reason !== RETURN_TO_STOCK)),
  returned: byUnit(rows.filter((r) => r.reason === RETURN_TO_STOCK)),
});

/**
 * True when the cook is about to log sellable stock as "used" because it went to the bar or floor: it hasn't been consumed, it moves
 * with the venue and is deducted for real when it sells. The web asks the same question. An item whose type the phone does not know yet
 * (a list saved before it was sent) is treated as the default type, a kitchen ingredient.
 */
export const needsMoveWarning = (reason: string | null, itemType: string | undefined) => reason === "foh_operations" && FOH_MOVE_ITEM_TYPES.includes(itemType || "KITCHEN_INGREDIENT");
