import { describe, it, expect } from "vitest";
import type { WasteEntry } from "@culinaire/shared/schemas/waste";
import type { OutboxEntry } from "../outbox/outbox";
import { dayTotals, localDayBounds, mergeWaste } from "./wasteView";
import type { WasteLogCommand } from "./wasteCommands";

const server = (over: Partial<WasteEntry> = {}): WasteEntry => ({ wasteLogId: "w1", userId: 1, storeLocationId: "L1", ingredientName: "Basil", quantity: 1, unit: "bunch", estimatedCost: null, reason: null, notes: null, shift: null, loggedAt: "2026-11-23T01:00:00.000Z", loggedBy: "Rob", ...over });
const cmd = (over: Partial<WasteLogCommand> = {}): WasteLogCommand => ({ wasteLogId: "w2", storeLocationId: "L1", ingredientName: "Chicken trim", quantity: 2, unit: "kg", reason: null, shift: null, estimatedCost: null, notes: null, loggedAt: "2026-11-23T02:00:00.000Z", ...over });
let n = 0;
const entry = (type: string, command: unknown, status: OutboxEntry["status"] = "SAVED_LOCAL", attention?: OutboxEntry["attention"]): OutboxEntry<unknown> =>
  ({ id: `q${++n}`, userId: 1, type, version: 1, status, command, attempts: 0, serverFailures: 0, nextAttemptAt: 0, createdAt: n, updatedAt: n, ...(attention ? { attention } : {}) });
const day = { start: "2026-11-22T13:00:00.000Z", end: "2026-11-23T12:59:59.999Z" };

describe("local day", () => {
  it("is midnight to the last millisecond in the phone's own time, as ISO (the server reads a timestamp as it is, a bare date as a UTC day)", () => {
    const { start, end } = localDayBounds(new Date(2026, 10, 23, 15, 30));
    expect(new Date(start).getTime()).toBe(new Date(2026, 10, 23).getTime());
    expect(new Date(end).getTime()).toBe(new Date(2026, 10, 24).getTime() - 1);
  });
});

describe("what the waste list shows", () => {
  it("is the server's entries with the ones still on the phone added, newest first, each saying whether it has been sent", () => {
    const rows = mergeWaste([server()], [entry("waste.log", cmd())], day);
    expect(rows.map((r) => [r.ingredientName, r.sync])).toEqual([["Chicken trim", "waiting"], ["Basil", "synced"]]);
  });

  it("shows an accepted log once, not again when the server's list has caught up", () => {
    const rows = mergeWaste([server({ wasteLogId: "w2", ingredientName: "Chicken trim" })], [entry("waste.log", cmd(), "ACCEPTED")], day);
    expect(rows).toHaveLength(1);
    expect(rows[0].sync).toBe("synced");
    expect(mergeWaste([], [entry("waste.log", cmd(), "ACCEPTED")], day)).toHaveLength(1); // not on the server's list yet
  });

  it("applies waiting edits to the entry and marks it waiting; hides an entry with a waiting delete", () => {
    const rows = mergeWaste([server(), server({ wasteLogId: "w9", ingredientName: "Gin" })], [entry("waste.edit", { wasteLogId: "w1", label: "Basil", changes: { quantity: 3, reason: "Expired" } }), entry("waste.delete", { wasteLogId: "w9", label: "Gin" })], day);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ingredientName: "Basil", quantity: 3, reason: "Expired", sync: "waiting" });
  });

  it("keeps a refusal on screen with the server's words and the entry to retry or discard", () => {
    const stuck = entry("waste.log", cmd(), "NEEDS_ATTENTION", { reason: "no_access", message: "You don't work there" });
    const [row] = mergeWaste([], [stuck], day);
    expect(row).toMatchObject({ sync: "attention", attentionMessage: "You don't work there", entryId: stuck.id });
  });

  it("a refused delete leaves the entry on screen so the person sees it was not removed", () => {
    const stuck = entry("waste.delete", { wasteLogId: "w1", label: "Basil" }, "NEEDS_ATTENTION", { reason: "no_access", message: "Not yours" });
    const [row] = mergeWaste([server()], [stuck], day);
    expect(row).toMatchObject({ ingredientName: "Basil", sync: "attention", entryId: stuck.id });
  });

  it("leaves out entries from another day", () => {
    expect(mergeWaste([], [entry("waste.log", cmd({ loggedAt: "2026-11-21T02:00:00.000Z" }))], day)).toEqual([]);
  });
});

describe("the day's totals", () => {
  it("adds up each unit on its own (the web adds kilos to bunches and calls it kilos), plus the cost known and the entry count", () => {
    const rows = mergeWaste([server({ quantity: 2, unit: "kg", estimatedCost: 5 }), server({ wasteLogId: "w3", quantity: 1.5, unit: "kg" }), server({ wasteLogId: "w4", quantity: 3, unit: "bunch", estimatedCost: 1.25 })], [], day);
    expect(dayTotals(rows)).toEqual({ entries: 3, cost: 6.25, byUnit: [{ unit: "kg", quantity: 3.5 }, { unit: "bunch", quantity: 3 }] });
  });

  it("is empty with nothing logged", () => {
    expect(dayTotals([])).toEqual({ entries: 0, cost: 0, byUnit: [] });
  });
});
