/**
 * What the prep screen shows: today's tasks from the server with the commands still on the phone laid over them, so a tick
 * shows at once and a refused one stays on its row with the reason. Pure functions.
 */

import type { PrepSession, PrepTask, PrepToday } from "@culinaire/shared/schemas/prep";
import type { OutboxEntry } from "../outbox/outbox";
import { PREP_CREATE, PREP_GENERATE, PREP_SELECTIONS, PREP_TICK, type PrepCreateCommand, type PrepTickCommand } from "./prepCommands";

/** "synced" is on the server; "waiting" is saved on the phone and will be sent; "attention" was refused or keeps failing: the person decides. */
export type RowSync = "synced" | "waiting" | "attention";

export interface PrepRow extends PrepTask {
  sync: RowSync;
  /** The queue entry that is waiting or stuck for this row, for retry and discard. */
  entryId?: string;
  attentionMessage?: string;
}

/** The making of today's list (create, dishes, generate) while any step is still on the phone. */
export interface PrepPlan {
  sync: "waiting" | "attention";
  entryId?: string;
  message?: string;
}

export interface PrepList {
  session: PrepSession | null;
  rows: PrepRow[];
  progress: { done: number; skipped: number; total: number };
  plan: PrepPlan | null;
}

/** The phone's own calendar date, `YYYY-MM-DD`: a kitchen's day is not the UTC day. */
export function localDate(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

const OPEN = ["SAVED_LOCAL", "SENDING", "NEEDS_ATTENTION"];
const PLAN_TYPES = [PREP_CREATE, PREP_SELECTIONS, PREP_GENERATE];

/** The server's tasks for today with this account's waiting and stuck commands laid over them. `entries` are oldest first. */
export function mergePrep(server: PrepToday | null, entries: OutboxEntry<unknown>[], userId: number, today: string, locationId: string): PrepList {
  const tasks = new Map<string, PrepRow>();
  for (const t of server?.tasks ?? []) tasks.set(t.prepTaskId, { ...t, sync: "synced" });

  for (const e of entries) {
    if (e.type !== PREP_TICK || !OPEN.includes(e.status)) continue;
    const c = e.command as PrepTickCommand;
    const row = tasks.get(c.prepTaskId);
    if (!row) continue;
    const done = c.status === "completed";
    tasks.set(c.prepTaskId, { ...row, status: c.status, completedAt: done ? c.completedAt : null, completedBy: done ? userId : null, sync: e.status === "NEEDS_ATTENTION" ? "attention" : "waiting", entryId: e.id, attentionMessage: e.attention?.message });
  }

  const rows = [...tasks.values()];
  return { session: server?.session ?? null, rows, progress: { done: rows.filter((r) => r.status === "completed").length, skipped: rows.filter((r) => r.status === "skipped").length, total: rows.length }, plan: planOf(server?.session.prepSessionId, entries, today, locationId) };
}

/** Today's plan at this location: the creates made for it, then every step of those sessions that is still open. */
function planOf(serverSessionId: string | undefined, entries: OutboxEntry<unknown>[], today: string, locationId: string): PrepPlan | null {
  const sessions = new Set<string>(serverSessionId ? [serverSessionId] : []);
  for (const e of entries) {
    const c = e.command as PrepCreateCommand;
    if (e.type === PREP_CREATE && c.prepDate === today && c.storeLocationId === locationId) sessions.add(c.prepSessionId);
  }
  const open = entries.filter((e) => PLAN_TYPES.includes(e.type) && OPEN.includes(e.status) && sessions.has((e.command as PrepCreateCommand).prepSessionId));
  if (open.length === 0) return null;
  const stuck = open.find((e) => e.status === "NEEDS_ATTENTION");
  return stuck ? { sync: "attention", entryId: stuck.id, message: stuck.attention?.message } : { sync: "waiting" };
}

const TIERS: { key: string; title: string }[] = [
  { key: "start_first", title: "Start with these" },
  { key: "then_these", title: "Next up" },
  { key: "can_wait", title: "Can wait" },
];

export interface TierGroup {
  title: string;
  rows: PrepRow[];
  done: number;
}

/** Rows grouped as the web does: start first, next up, can wait. A tier this build does not know is "next up". Empty tiers are left out. */
export function groupByTier(rows: PrepRow[]): TierGroup[] {
  const known = TIERS.map((t) => t.key);
  return TIERS.map((t) => {
    const inTier = rows.filter((r) => (known.includes(r.priorityTier) ? r.priorityTier : "then_these") === t.key);
    return { title: t.title, rows: inTier, done: inTier.filter((r) => r.status === "completed").length };
  }).filter((g) => g.rows.length > 0);
}

/** As the web writes them: one decimal for kg, L and lb, a whole number for everything else. */
export function quantityText(value: number, unit: string): string {
  const u = unit.toLowerCase();
  const text = u === "kg" || u === "l" || u === "lb" ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${text} ${unit}`;
}

/** "In stock (6 kg on hand)" when nothing needs prepping, "1 kg on hand" otherwise, null when the item's stock is not tracked. */
export function stockText(t: Pick<PrepTask, "onHandQty" | "prepNeeded" | "unit">): string | null {
  if (t.onHandQty === null) return null;
  const onHand = `${quantityText(t.onHandQty, t.unit)} on hand`;
  return t.prepNeeded !== null && t.prepNeeded <= 0 ? `In stock (${onHand})` : onHand;
}

/** The dishes a task is for. The server writes "Prep <ingredient> for <dishes>"; anything else has no dishes to show. */
export function dishesOf(t: Pick<PrepTask, "taskDescription" | "ingredientName">): string | null {
  const prefix = `Prep ${t.ingredientName} for `;
  return t.taskDescription.startsWith(prefix) && t.taskDescription.length > prefix.length ? t.taskDescription.slice(prefix.length) : null;
}
