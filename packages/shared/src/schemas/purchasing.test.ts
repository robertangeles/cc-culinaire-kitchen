import { describe, it, expect } from "vitest";
import { CreditNoteListSchema, DiscrepancyListSchema, OrderDetailSchema, OrderEmailReplySchema, OrderGuideItemListSchema, OrderItemListSchema, OrderListSchema, OrderSubmitReplySchema, OrderWriteReplySchema } from "./purchasing.js";

const order = { poId: "p1", poNumber: "PO-1", status: "SENT", storeLocationId: "L1", supplierId: "s1", supplierName: "Fresh Farms", lineCount: 2, totalValue: "120.5000" };

describe("purchasing schemas", () => {
  it("reads money and quantities as numbers", () => {
    expect(OrderListSchema.parse([order])[0]).toMatchObject({ totalValue: 120.5, lineCount: 2, locationName: null });
    expect(OrderDetailSchema.parse({ ...order, lines: [{ lineId: "l1", ingredientId: "i1", ingredientName: "Flour", orderedQty: "2.00", orderedUnit: "bag", unitCost: "17.5", lineStatus: "PENDING" }] }).lines[0]).toMatchObject({ orderedQty: 2, unitCost: 17.5, receivedQty: null });
  });

  it("reads a figure the server left out as unknown, never as zero", () => {
    const { totalValue: _hidden, ...noCost } = order;
    expect(OrderListSchema.parse([noCost])[0].totalValue).toBeNull();
    expect(OrderDetailSchema.parse({ ...noCost, lines: [{ lineId: "l1", ingredientId: "i1", orderedQty: "2", orderedUnit: "bag" }] }).lines[0]).toMatchObject({ unitCost: null, actualUnitCost: null });
    expect(OrderItemListSchema.parse([{ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg" }])[0]).toMatchObject({ currentQty: null, locationUnitCost: null, orgUnitCost: null });
    expect(OrderGuideItemListSchema.parse([{ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", unitCost: null }])[0]).toMatchObject({ onHand: null, unitCost: null });
    expect(DiscrepancyListSchema.parse([{ discrepancyId: "d1", type: "SHORT", poId: "p1", supplierId: "s1", maxCreditAmount: null }])[0].maxCreditAmount).toBeNull();
  });

  it("keeps a status it does not know, and skips only the row it cannot read", () => {
    expect(OrderListSchema.parse([{ ...order, status: "ON_HOLD" }, { poNumber: "no id" }]).map((o) => o.status)).toEqual(["ON_HOLD"]);
    expect(CreditNoteListSchema.parse([{ creditNoteId: "c1", discrepancyId: "d1", supplierId: "s1", creditAmount: "8.00" }, null])).toHaveLength(1);
  });

  it("reads the approver's right only when the server sends it", () => {
    expect(OrderListSchema.parse([{ ...order, canApprove: false }])[0].canApprove).toBe(false);
    expect(OrderListSchema.parse([order])[0].canApprove).toBeUndefined();
  });

  it("reads the write replies", () => {
    expect(OrderWriteReplySchema.parse({ ...order, lines: [] })).toEqual({ poId: "p1", poNumber: "PO-1", skippedItems: [], quantityWarnings: [] });
    expect(OrderWriteReplySchema.parse({ ...order, quantityWarnings: [{ ingredientId: "i1", ingredientName: "Rye", code: "UNIT_NOT_CONVERTIBLE" }] }).quantityWarnings).toEqual([{ ingredientName: "Rye" }]);
    expect(OrderSubmitReplySchema.parse({ ...order, status: "PENDING_APPROVAL", routing: "HQ_APPROVAL" }).status).toBe("PENDING_APPROVAL");
    expect(OrderEmailReplySchema.parse({ emailed: false, reason: "no_supplier_email", message: "No email on file." })).toEqual({ emailed: false, to: null, message: "No email on file." });
  });
});
