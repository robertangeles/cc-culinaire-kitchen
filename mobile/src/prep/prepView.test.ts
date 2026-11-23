import { describe, it, expect } from "vitest";
import type { PrepSession, PrepTask } from "@culinaire/shared/schemas/prep";
import type { OutboxEntry, OutboxStatus } from "../outbox/outbox";
import { dishesOf, groupByTier, localDate, mergePrep, quantityText, stockText } from "./prepView";

const SESSION = "s1";
const session = (over: Partial<PrepSession> = {}): PrepSession => ({ prepSessionId: SESSION, userId: 9, prepDate: "2026-11-23", expectedCovers: 80, actualCovers: null, tasksTotal: 2, tasksCompleted: 0, tasksSkipped: 0, isEnded: false, ...over });
const task = (over: Partial<PrepTask> = {}): PrepTask => ({ prepTaskId: "t1", prepSessionId: SESSION, taskDescription: "Prep Onion for Soup, Pie", ingredientName: "Onion", quantityNeeded: 4.5, unit: "kg", prepTimeMinutes: 20, priorityTier: "start_first", station: "Veg", onHandQty: 1, prepNeeded: 3.5, status: "pending", assignedTo: null, completedAt: null, completedBy: null, ...over });
let n = 0;
const entry = (type: string, command: unknown, status: OutboxStatus = "SAVED_LOCAL", message?: string): OutboxEntry<unknown> => ({ id: `e${++n}`, userId: 1, type, version: 1, status, command, attempts: 0, serverFailures: 0, nextAttemptAt: 0, createdAt: n, updatedAt: n, ...(message ? { attention: { reason: "rejected" as const, message } } : {}) });
const tick = (status: "pending" | "completed" | "skipped", over: object = {}) => ({ prepTaskId: "t1", prepSessionId: SESSION, label: "Onion", status, completedAt: status === "completed" ? "2026-11-23T01:00:00.000Z" : null, ...over });
const TODAY = "2026-11-23";

describe("the phone's date", () => {
  it("is the local calendar date, not the UTC one (a morning in Sydney is yesterday in UTC)", () => {
    expect(localDate(new Date(2026, 10, 23, 7, 30))).toBe("2026-11-23");
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("the list with the queue laid over it", () => {
  it("shows the server's tasks as sent, with progress", () => {
    const list = mergePrep({ session: session(), tasks: [task(), task({ prepTaskId: "t2", status: "completed" }), task({ prepTaskId: "t3", status: "skipped" })] }, [], 1, TODAY, "L1");
    expect(list.rows.map((r) => [r.prepTaskId, r.sync])).toEqual([["t1", "synced"], ["t2", "synced"], ["t3", "synced"]]);
    expect(list.progress).toEqual({ done: 1, skipped: 1, total: 3 });
    expect(list.plan).toBeNull();
  });

  it("shows a tick waiting to send at once, as done by me, and counts it", () => {
    const list = mergePrep({ session: session(), tasks: [task()] }, [entry("prep.tick", tick("completed"))], 1, TODAY, "L1");
    expect(list.rows[0]).toMatchObject({ status: "completed", sync: "waiting", completedBy: 1, completedAt: "2026-11-23T01:00:00.000Z" });
    expect(list.progress.done).toBe(1);
  });

  it("shows an untick and a skip waiting to send", () => {
    const list = mergePrep({ session: session(), tasks: [task({ status: "completed", completedBy: 5, completedAt: "x" }), task({ prepTaskId: "t2" })] }, [entry("prep.tick", tick("pending", { prepTaskId: "t1" })), entry("prep.tick", tick("skipped", { prepTaskId: "t2" }))], 1, TODAY, "L1");
    expect(list.rows[0]).toMatchObject({ status: "pending", completedBy: null, completedAt: null, sync: "waiting" });
    expect(list.rows[1]).toMatchObject({ status: "skipped", sync: "waiting" });
  });

  it("keeps a refused tick on the row with the server's reason, still showing what the cook did", () => {
    const list = mergePrep({ session: session(), tasks: [task()] }, [entry("prep.tick", tick("completed"), "NEEDS_ATTENTION", "This prep session has ended")], 1, TODAY, "L1");
    expect(list.rows[0]).toMatchObject({ status: "completed", sync: "attention", attentionMessage: "This prep session has ended" });
    expect(list.rows[0].entryId).toBeTruthy();
  });

  it("does not lay a tick that was already sent over the server's list (the server's word is newer)", () => {
    const list = mergePrep({ session: session(), tasks: [task({ status: "pending" })] }, [entry("prep.tick", tick("completed"), "ACCEPTED")], 1, TODAY, "L1");
    expect(list.rows[0]).toMatchObject({ status: "pending", sync: "synced" });
  });

  it("ignores a tick for a task the list no longer has", () => {
    expect(mergePrep({ session: session(), tasks: [task()] }, [entry("prep.tick", tick("completed", { prepTaskId: "gone" }))], 1, TODAY, "L1").rows).toHaveLength(1);
  });
});

describe("a plan that has not reached the server", () => {
  const create = { prepSessionId: "new", storeLocationId: "L1", prepDate: TODAY, expectedCovers: null };

  it("says the list is waiting to be made when no session is on the server yet", () => {
    const list = mergePrep(null, [entry("prep.create", create), entry("prep.selections", { prepSessionId: "new", selections: [] }), entry("prep.generate", { prepSessionId: "new", requestId: "r" })], 1, TODAY, "L1");
    expect(list.session).toBeNull();
    expect(list.rows).toEqual([]);
    expect(list.plan).toMatchObject({ sync: "waiting" });
  });

  it("surfaces a refused step of the plan with its reason and the entry to retry or discard", () => {
    const stuck = entry("prep.create", create, "NEEDS_ATTENTION", "You don't work at that location");
    const list = mergePrep(null, [stuck, entry("prep.generate", { prepSessionId: "new", requestId: "r" })], 1, TODAY, "L1");
    expect(list.plan).toEqual({ sync: "attention", entryId: stuck.id, message: "You don't work at that location" });
  });

  it("is waiting for the list to be made when a session exists but its tasks are still to come", () => {
    const list = mergePrep({ session: session(), tasks: [] }, [entry("prep.generate", { prepSessionId: SESSION, requestId: "r" })], 1, TODAY, "L1");
    expect(list.plan).toMatchObject({ sync: "waiting" });
  });

  it("ignores a plan for another day or another location", () => {
    expect(mergePrep(null, [entry("prep.create", { ...create, prepDate: "2026-11-22" })], 1, TODAY, "L1").plan).toBeNull();
    expect(mergePrep(null, [entry("prep.create", { ...create, storeLocationId: "L2" })], 1, TODAY, "L1").plan).toBeNull();
  });

  it("shows nothing once the plan was accepted", () => {
    expect(mergePrep(null, [entry("prep.create", create, "ACCEPTED")], 1, TODAY, "L1").plan).toBeNull();
  });
});

describe("groups and words", () => {
  it("groups by tier in the order a cook works them, with how many are done, and puts a tier it does not know with 'next up'", () => {
    const rows = mergePrep({ session: session(), tasks: [task({ prepTaskId: "a", priorityTier: "can_wait" }), task({ prepTaskId: "b", priorityTier: "start_first", status: "completed" }), task({ prepTaskId: "c", priorityTier: "later" }), task({ prepTaskId: "d", priorityTier: "start_first" })] }, [], 1, TODAY, "L1").rows;
    const groups = groupByTier(rows);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.prepTaskId), g.done])).toEqual([["Start with these", ["b", "d"], 1], ["Next up", ["c"], 0], ["Can wait", ["a"], 0]]);
  });

  it("leaves out a tier with nothing in it", () => {
    expect(groupByTier(mergePrep({ session: session(), tasks: [task({ priorityTier: "can_wait" })] }, [], 1, TODAY, "L1").rows).map((g) => g.title)).toEqual(["Can wait"]);
  });

  it("writes quantities as the web does: one decimal for kg, L and lb, whole numbers otherwise", () => {
    expect(quantityText(4.5, "kg")).toBe("4.5 kg");
    expect(quantityText(4, "kg")).toBe("4 kg");
    expect(quantityText(2.25, "L")).toBe("2.3 L");
    expect(quantityText(11.6, "each")).toBe("12 each");
  });

  it("says what is on hand, or that it is in stock, or nothing when stock is not tracked", () => {
    expect(stockText(task({ onHandQty: 1, prepNeeded: 3.5 }))).toBe("1 kg on hand");
    expect(stockText(task({ onHandQty: 6, prepNeeded: 0 }))).toBe("In stock (6 kg on hand)");
    expect(stockText(task({ onHandQty: null, prepNeeded: null }))).toBeNull();
  });

  it("reads the dishes a task is for from its description, even when the ingredient's own name has 'for' in it", () => {
    expect(dishesOf(task())).toBe("Soup, Pie");
    expect(dishesOf(task({ ingredientName: "Stock for Sauce", taskDescription: "Prep Stock for Sauce for Beef Wellington" }))).toBe("Beef Wellington");
    expect(dishesOf(task({ taskDescription: "Something typed by hand" }))).toBeNull();
  });
});
