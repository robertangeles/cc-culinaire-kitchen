import { describe, it, expect } from "vitest";
import type { ConsumptionEntry } from "@culinaire/shared/schemas/consumption";
import type { OutboxEntry } from "../outbox/outbox";
import { dayTotals, mergeConsumption, needsMoveWarning, canChange, type Viewer } from "./consumptionView";
import type { ConsumptionLogCommand } from "./consumptionCommands";

const day = { start: "2026-11-23T00:00:00.000Z", end: "2026-11-23T23:59:59.999Z" };
const me: Viewer = { userId: 1, userName: "Cook", isAdmin: false };
const server = (over: Partial<ConsumptionEntry> = {}): ConsumptionEntry => ({ consumptionLogId: "c1", ingredientId: "i1", ingredientName: "Gin", quantity: 0.7, unit: "L", reason: "foh_operations", notes: null, shift: null, loggedAt: "2026-11-23T10:00:00.000Z", userId: 1, userName: "Cook", ...over });
const cmd = (over: Partial<ConsumptionLogCommand> = {}): ConsumptionLogCommand => ({ consumptionLogId: "c2", storeLocationId: "L1", ingredientId: "i2", ingredientName: "Salt", quantity: 1, unit: "kg", reason: "kitchen_operations", shift: null, notes: null, loggedAt: "2026-11-23T11:00:00.000Z", ...over });
const entry = (type: string, command: unknown, status: OutboxEntry["status"] = "SAVED_LOCAL", id = "e1"): OutboxEntry<unknown> => ({ id, type, version: 1, command, status, attempts: 0, createdAt: 1, updatedAt: 1, userId: 1, attention: status === "NEEDS_ATTENTION" ? { reason: "rejected", message: "Refused" } : undefined } as unknown as OutboxEntry<unknown>);

describe("mergeConsumption", () => {
  it("puts an entry made on the phone on the list at once, as waiting, newest first, under the viewer's name", () => {
    const rows = mergeConsumption([server()], [entry("consumption.log", cmd())], day, me);
    expect(rows.map((r) => [r.ingredientName, r.sync, r.userName])).toEqual([["Salt", "waiting", "Cook"], ["Gin", "synced", "Cook"]]);
  });

  it("shows an edit before it is sent, and a delete removes the entry at once", () => {
    const edited = mergeConsumption([server()], [entry("consumption.edit", { consumptionLogId: "c1", label: "Gin", changes: { quantity: 2, shift: "evening" } })], day, me);
    expect(edited[0]).toMatchObject({ quantity: 2, shift: "evening", sync: "waiting", entryId: "e1" });
    expect(mergeConsumption([server()], [entry("consumption.delete", { consumptionLogId: "c1", label: "Gin" })], day, me)).toEqual([]);
  });

  it("keeps an entry the server refused to change, with the server's words, and brings back an entry whose delete was refused", () => {
    const refusedEdit = mergeConsumption([server()], [entry("consumption.edit", { consumptionLogId: "c1", label: "Gin", changes: { quantity: 2 } }, "NEEDS_ATTENTION")], day, me);
    expect(refusedEdit[0]).toMatchObject({ sync: "attention", attentionMessage: "Refused" });
    const refusedDelete = mergeConsumption([server()], [entry("consumption.delete", { consumptionLogId: "c1", label: "Gin" }, "NEEDS_ATTENTION")], day, me);
    expect(refusedDelete[0]).toMatchObject({ sync: "attention", attentionMessage: "Refused" });
  });

  it("uses the server's row once an entry is sent, and leaves out other days", () => {
    const rows = mergeConsumption([server({ consumptionLogId: "c2", quantity: 1.5, loggedAt: "2026-11-23T11:05:00.000Z" }), server({ consumptionLogId: "old", loggedAt: "2026-11-22T10:00:00.000Z" })], [entry("consumption.log", cmd(), "ACCEPTED")], day, me);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ consumptionLogId: "c2", quantity: 1.5, sync: "synced" });
  });
});

describe("dayTotals", () => {
  it("adds each unit on its own, keeps returns apart from usage, and counts every entry", () => {
    const rows = mergeConsumption([server(), server({ consumptionLogId: "c3", quantity: 0.3 }), server({ consumptionLogId: "c4", ingredientName: "Salt", unit: "kg", quantity: 2, reason: "kitchen_operations" }), server({ consumptionLogId: "c5", quantity: 0.5, reason: "return_to_stock" })], [], day, me);
    expect(dayTotals(rows)).toEqual({ entries: 4, used: [{ unit: "kg", quantity: 2 }, { unit: "L", quantity: 1 }], returned: [{ unit: "L", quantity: 0.5 }] });
  });
});

describe("who may change an entry", () => {
  it("is the person who logged it, or an Administrator", () => {
    const [row] = mergeConsumption([server({ userId: 9, userName: "Other" })], [], day, me);
    expect(canChange(row, me)).toBe(false);
    expect(canChange(row, { ...me, userId: 9 })).toBe(true);
    expect(canChange(row, { ...me, isAdmin: true })).toBe(true);
  });
});

describe("needsMoveWarning", () => {
  it("asks 'that's a move, not usage' for FOH usage of kitchen ingredients and FOH consumables only", () => {
    expect(needsMoveWarning("foh_operations", "KITCHEN_INGREDIENT")).toBe(true);
    expect(needsMoveWarning("foh_operations", "FOH_CONSUMABLE")).toBe(true);
    expect(needsMoveWarning("foh_operations", "OPERATIONAL_SUPPLY")).toBe(false);
    expect(needsMoveWarning("kitchen_operations", "KITCHEN_INGREDIENT")).toBe(false);
    expect(needsMoveWarning(null, "KITCHEN_INGREDIENT")).toBe(false);
  });

  it("treats an item whose type is not known yet as the default type, a kitchen ingredient", () => {
    expect(needsMoveWarning("foh_operations", "")).toBe(true);
    expect(needsMoveWarning("foh_operations", undefined)).toBe(true);
  });
});
