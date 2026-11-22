/**
 * What the waste screen shows: the server's entries for today with the commands still on the phone laid over them,
 * so a log made offline is on the list at once and an edit or delete shows before it is sent. Pure functions.
 */

import type { WasteEntry } from "@culinaire/shared/schemas/waste";
import type { OutboxEntry } from "../outbox/outbox";
import { WASTE_DELETE, WASTE_EDIT, WASTE_LOG, type WasteChanges, type WasteDeleteCommand, type WasteEditCommand, type WasteLogCommand } from "./wasteCommands";

/** "synced" is on the server; "waiting" is saved on the phone and will be sent; "attention" was refused or keeps failing: the person decides. */
export type RowSync = "synced" | "waiting" | "attention";

export interface WasteRow {
  wasteLogId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  reason: string | null;
  shift: string | null;
  notes: string | null;
  estimatedCost: number | null;
  loggedAt: string;
  sync: RowSync;
  /** The queue entry that is waiting or stuck for this row, for retry and discard. */
  entryId?: string;
  attentionMessage?: string;
}

/** Midnight to the last millisecond of the day `at` falls in, in the phone's time zone, as ISO. */
export function localDayBounds(at: Date): { start: string; end: string } {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
  return { start: start.toISOString(), end: new Date(end.getTime() - 1).toISOString() };
}

const OPEN = ["SAVED_LOCAL", "SENDING", "NEEDS_ATTENTION"];
const syncOf = (e: OutboxEntry<unknown>): RowSync => (e.status === "NEEDS_ATTENTION" ? "attention" : OPEN.includes(e.status) ? "waiting" : "synced");

function fromLog(c: WasteLogCommand, e: OutboxEntry<unknown>): WasteRow {
  return { wasteLogId: c.wasteLogId, ingredientName: c.ingredientName, quantity: c.quantity, unit: c.unit, reason: c.reason, shift: c.shift, notes: c.notes, estimatedCost: c.estimatedCost, loggedAt: c.loggedAt, sync: syncOf(e), ...(e.status === "NEEDS_ATTENTION" ? { entryId: e.id, attentionMessage: e.attention?.message } : OPEN.includes(e.status) ? { entryId: e.id } : {}) };
}

/** The server's entries and this account's queue entries, for one day, newest first. `entries` are oldest first, as the outbox lists them. */
export function mergeWaste(serverRows: WasteEntry[], entries: OutboxEntry<unknown>[], day: { start: string; end: string }): WasteRow[] {
  const rows = new Map<string, WasteRow>();
  for (const s of serverRows) rows.set(s.wasteLogId, { ...s, sync: "synced" });

  for (const e of entries) {
    if (e.type === WASTE_LOG) {
      const c = e.command as WasteLogCommand;
      if (!rows.has(c.wasteLogId) || OPEN.includes(e.status)) rows.set(c.wasteLogId, fromLog(c, e));
    } else if (e.type === WASTE_EDIT) {
      const c = e.command as WasteEditCommand;
      const row = rows.get(c.wasteLogId);
      if (!row || !OPEN.includes(e.status)) continue;
      const changes: WasteChanges = c.changes;
      rows.set(c.wasteLogId, { ...row, ...changes, sync: e.status === "NEEDS_ATTENTION" || row.sync === "attention" ? "attention" : "waiting", entryId: row.entryId ?? e.id, ...(e.status === "NEEDS_ATTENTION" ? { entryId: e.id, attentionMessage: e.attention?.message } : {}) });
    } else if (e.type === WASTE_DELETE) {
      const c = e.command as WasteDeleteCommand;
      const row = rows.get(c.wasteLogId);
      if (!row || !OPEN.includes(e.status)) continue;
      // A delete waiting to be sent hides the entry (the person has deleted it); a refused one brings it back with the reason.
      if (e.status === "NEEDS_ATTENTION") rows.set(c.wasteLogId, { ...row, sync: "attention", entryId: e.id, attentionMessage: e.attention?.message });
      else rows.delete(c.wasteLogId);
    }
  }

  return [...rows.values()].filter((r) => r.loggedAt >= day.start && r.loggedAt <= day.end).sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : a.loggedAt > b.loggedAt ? -1 : 0));
}

export interface DayTotals {
  entries: number;
  /** Only the entries that have a cost. */
  cost: number;
  /** One line per unit, biggest first: kilos and bunches are never added together. */
  byUnit: { unit: string; quantity: number }[];
}

export function dayTotals(rows: WasteRow[]): DayTotals {
  const units = new Map<string, number>();
  let cost = 0;
  for (const r of rows) {
    units.set(r.unit, (units.get(r.unit) ?? 0) + r.quantity);
    cost += r.estimatedCost ?? 0;
  }
  return { entries: rows.length, cost: Math.round(cost * 100) / 100, byUnit: [...units].map(([unit, quantity]) => ({ unit, quantity: Math.round(quantity * 1000) / 1000 })).sort((a, b) => b.quantity - a.quantity) };
}
