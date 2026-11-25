import { describe, it, expect } from "vitest";
import { TransferDetailSchema, TransferListSchema } from "./transfer.js";
import { LocationDashboardSchema, LocationItemListSchema, StockAcrossLocationsSchema, AreaAssignmentsSchema } from "./storeRoom.js";

// Shaped like the real replies of the Wave 3 server (PR 219). The point: a field the server leaves out for a person
// without `inventory:cost` stays absent (a dash on screen), never becomes 0.

const summary = { transferId: "t1", organisationId: 1, fromLocationId: "L1", toLocationId: "L2", status: "SENT", notes: null, sentDttm: "2026-11-23T09:00:00.000Z", receivedDttm: null, createdDttm: "2026-11-23T08:00:00.000Z", fromLocationName: "Main", toLocationName: "Bar", initiatorName: "Sam", lineCount: 2 };

describe("transfer schemas", () => {
  it("reads the list and skips a row it cannot show, never the whole list", () => {
    const rows = TransferListSchema.parse([summary, { status: "SENT" }, { ...summary, transferId: "t2", status: "SOMETHING_NEW", lineCount: "3", brandNew: 1 }]);
    expect(rows.map((r) => r.transferId)).toEqual(["t1", "t2"]);
    expect(rows[1]).toMatchObject({ status: "SOMETHING_NEW", lineCount: 3 });
    expect(rows[1]).not.toHaveProperty("brandNew");
  });

  it("reads a detail with numeric strings as numbers and a line not yet received as null", () => {
    const d = TransferDetailSchema.parse({ ...summary, initiatedByUserId: 4, sentByUserId: 4, receivedByUserId: null, lines: [
      { lineId: "l1", ingredientId: "i1", sentQty: "2.500", sentUnit: "kg", receivedQty: null, lineStatus: "PENDING", ingredientName: "Salt", ingredientCategory: "dry_goods", baseUnit: "kg" },
      { lineId: "l2", ingredientId: "i2", sentQty: "1", sentUnit: "L", receivedQty: "0.000", lineStatus: "DISCREPANCY", ingredientName: null, baseUnit: "L" },
    ] });
    expect(d.lines[0]).toMatchObject({ sentQty: 2.5, receivedQty: null, ingredientName: "Salt" });
    expect(d.lines[1]).toMatchObject({ receivedQty: 0, ingredientName: "" });
    expect(d.receivedByUserId).toBeNull();
  });
});

describe("stock room schemas", () => {
  const level = { ingredientId: "i1", ingredientName: "Salt", ingredientCategory: "dry_goods", baseUnit: "kg", currentQty: "4.000", lastCountedDttm: null, parLevel: "10", activeInd: true };

  it("keeps the value and quantities for someone who may see them", () => {
    const d = LocationDashboardSchema.parse({ stockLevels: [level], stockSummary: { lowCount: 1, criticalCount: 0, lowIngredientIds: ["i1"], criticalIngredientIds: [], stockValue: 123.4, valueByCategory: [{ category: "dry_goods", value: 123.4 }] }, activeSession: null, lastCompletedSession: { closedDttm: "2026-11-20T10:00:00.000Z" }, setupProgress: { inventoryActive: true } });
    expect(d.stockLevels[0]).toMatchObject({ currentQty: 4, parLevel: 10 });
    expect(d.stockSummary).toMatchObject({ stockValue: 123.4, lowIngredientIds: ["i1"] });
    expect(d.lastCompletedSession?.closedDttm).toBe("2026-11-20T10:00:00.000Z");
  });

  it("leaves a hidden quantity and value absent, not zero", () => {
    const { currentQty: _hidden, ...blind } = level;
    const d = LocationDashboardSchema.parse({ stockLevels: [blind], stockSummary: { lowCount: 0, criticalCount: 1, lowIngredientIds: [], criticalIngredientIds: ["i1"] }, activeSession: { sessionId: "s", categories: [{ categoryStatus: "SUBMITTED" }, { categoryStatus: "OPEN" }] }, lastCompletedSession: null });
    expect(d.stockLevels[0].currentQty).toBeUndefined();
    expect(d.stockSummary.stockValue).toBeUndefined();
    expect(d.stockSummary.valueByCategory).toBeUndefined();
    expect(d.activeSession).toEqual({ submitted: 1, total: 2 });
  });

  it("reads the location's item list, hidden fields absent", () => {
    const rows = LocationItemListSchema.parse([
      { ...level, itemType: "KITCHEN_INGREDIENT", unitOverride: null, supplierName: "Acme", orgParLevel: null, locationUnitCost: "2.10" },
      { ingredientId: "i2", ingredientName: "Napkins", baseUnit: "each", ingredientCategory: "supplies", parLevel: null, activeInd: null },
      { ingredientName: "no id" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ currentQty: 4, parLevel: 10, supplierName: "Acme", activeInd: true });
    expect(rows[1]).toMatchObject({ parLevel: null, activeInd: false });
    expect(rows[1].currentQty).toBeUndefined();
  });

  it("reads where an item is kept and its stock at each location", () => {
    expect(AreaAssignmentsSchema.parse({ i1: ["a1", "a2"], i2: "bad" })).toEqual({ i1: ["a1", "a2"] });
    const across = StockAcrossLocationsSchema.parse([{ storeLocationId: "L1", locationName: "Main", currentQty: "4", parLevel: null, lastCountedDttm: null, unitCost: "3" }, { storeLocationId: "L2", locationName: "Bar", currentQty: null }]);
    expect(across).toEqual([{ storeLocationId: "L1", locationName: "Main", currentQty: 4, parLevel: null }, { storeLocationId: "L2", locationName: "Bar", currentQty: null, parLevel: null }]);
  });
});
