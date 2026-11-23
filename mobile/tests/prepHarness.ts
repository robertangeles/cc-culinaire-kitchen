import { vi } from "vitest";
import type { PrepMenu, PrepSelection, PrepSession, PrepTask, PrepToday } from "@culinaire/shared/schemas/prep";
import { ApiError, type ApiClient } from "../src/api/client";
import { createOutbox, type Outbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import type { KvStore } from "../src/storage/kv";
import type { PrepApi } from "../src/prep/prepApi";
import { prepHandlers } from "../src/prep/prepCommands";
import { createPrepStore, type PrepStore } from "../src/prep/prepStore";

/** The one prep store a screen test renders against; the mocked `usePrep` reads it from here. */
export const prepHarness = { store: null as unknown as PrepStore, outbox: null as unknown as Outbox, canPlan: true };

/** 2026-11-23 10:00 in the phone's own zone, so "today" is the same wherever the test runs. */
export const NOW = new Date(2026, 10, 23, 10, 0).getTime();
export const TODAY = "2026-11-23";

export const sessionRow = (over: Partial<PrepSession> = {}): PrepSession => ({ prepSessionId: "s1", userId: 9, prepDate: TODAY, expectedCovers: 80, actualCovers: null, tasksTotal: 3, tasksCompleted: 0, tasksSkipped: 0, isEnded: false, ...over });
export const taskRow = (over: Partial<PrepTask> = {}): PrepTask => ({ prepTaskId: "t1", prepSessionId: "s1", taskDescription: "Prep Onion for Soup, Pie", ingredientName: "Onion", quantityNeeded: 4.5, unit: "kg", prepTimeMinutes: 20, priorityTier: "start_first", station: "Veg", onHandQty: 1, prepNeeded: 3.5, status: "pending", assignedTo: null, completedAt: null, completedBy: null, ...over });
export const todayOf = (tasks: PrepTask[] = [taskRow()], session: Partial<PrepSession> = {}): PrepToday => ({ session: sessionRow(session), tasks });

export interface PrepHarnessOptions {
  /** What the server answers for today; null is "nothing planned". */
  today?: PrepToday | null;
  todayFails?: ApiError;
  menu?: PrepMenu;
  menuFails?: ApiError;
  previous?: PrepSelection[];
  send?: ReturnType<typeof vi.fn>;
  userId?: number;
  locationId?: string;
}

export async function makePrepHarness(over: PrepHarnessOptions = {}) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  const request = over.send ?? vi.fn(async () => ({}));
  let n = 0;
  const userId = over.userId ?? 1;
  const outbox = createOutbox({ store, send: async () => {}, handlers: prepHandlers({ request } as unknown as ApiClient), now: () => NOW, newId: () => `e${String(++n).padStart(3, "0")}`, getUserId: () => userId });
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const serverToday = { current: over.today === undefined ? todayOf() : over.today };
  const api = {
    today: vi.fn(async () => { if (over.todayFails) throw over.todayFails; return serverToday.current; }),
    menu: vi.fn(async () => { if (over.menuFails) throw over.menuFails; return over.menu ?? { menuItems: [{ menuItemId: "m1", name: "Soup", category: "Starter" }, { menuItemId: "m2", name: "Pie", category: "Main" }], recipes: [{ recipeId: "r1", title: "House stock" }] }; }),
    previousSelections: vi.fn(async () => over.previous ?? []),
  } as unknown as PrepApi & { today: ReturnType<typeof vi.fn>; menu: ReturnType<typeof vi.fn>; previousSelections: ReturnType<typeof vi.fn> };
  let uuid = 0;
  const kick = vi.fn();
  const prep = createPrepStore({ api, kv, outbox, getUserId: () => userId, locationId: over.locationId ?? "L1", kick, now: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  await prep.refresh();
  prepHarness.store = prep;
  prepHarness.outbox = outbox;
  return { prep, outbox, request, kick, kv, api, rows, serverToday };
}
