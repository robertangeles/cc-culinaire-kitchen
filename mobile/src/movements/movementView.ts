/** What the moves screen shows: the server's latest moves with the ones still on the phone laid over them. Pure functions. */

import type { StockMovement } from "@culinaire/shared/schemas/stockMovement";
import type { OutboxEntry } from "../outbox/outbox";
import { OPEN, syncOf, type RowSync } from "../waste/wasteView";
import { MOVEMENT_LOG, type MovementLogCommand } from "./movementCommands";

export interface MovementRow {
  stockMovementId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  fromAreaName: string;
  toAreaName: string;
  userName: string | null;
  notes: string | null;
  movedAt: string;
  sync: RowSync;
  /** The queue entry that is waiting or stuck for this move, for retry and discard. */
  entryId?: string;
  attentionMessage?: string;
}

/** The server's moves and this account's queued ones, newest first. `entries` are oldest first, as the outbox lists them. */
export function mergeMovements(serverRows: StockMovement[], entries: OutboxEntry<unknown>[], userName: string): MovementRow[] {
  const rows = new Map<string, MovementRow>();
  for (const s of serverRows) rows.set(s.stockMovementId, { ...s, sync: "synced" });
  for (const e of entries) {
    if (e.type !== MOVEMENT_LOG) continue;
    const c = e.command as MovementLogCommand;
    if (rows.has(c.stockMovementId) && !OPEN.includes(e.status)) continue;
    rows.set(c.stockMovementId, { stockMovementId: c.stockMovementId, ingredientName: c.ingredientName, quantity: c.quantity, unit: c.unit, fromAreaName: c.fromAreaName, toAreaName: c.toAreaName, userName, notes: c.notes, movedAt: c.movedAt, sync: syncOf(e), ...(e.status === "NEEDS_ATTENTION" ? { entryId: e.id, attentionMessage: e.attention?.message } : OPEN.includes(e.status) ? { entryId: e.id } : {}) });
  }
  return [...rows.values()].sort((a, b) => (a.movedAt < b.movedAt ? 1 : a.movedAt > b.movedAt ? -1 : 0));
}
