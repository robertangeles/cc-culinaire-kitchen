import { describe, it, expect } from "vitest";
import { discrepancyValue, valueOf } from "./creditNoteService.js";

/** What a discrepancy is worth caps its credit note (Wave 5). Prices are per ordered unit. */
describe("discrepancyValue", () => {
  const base = { shortageQty: null, orderedQty: "10", receivedQty: "10", unitPrice: "4", varianceAmount: null };

  it("values a short delivery at the missing quantity times the order price", () => {
    expect(discrepancyValue({ ...base, type: "SHORT", shortageQty: "3", receivedQty: "7" })).toBe(12);
  });

  it.each(["REJECTED", "SUBSTITUTION"])("values %s at the whole ordered line", (type) => {
    expect(discrepancyValue({ ...base, type, receivedQty: "0" })).toBe(40);
  });

  it("values a price rise at the extra per unit times what arrived, and a price drop at nothing", () => {
    expect(discrepancyValue({ ...base, type: "PRICE_VARIANCE", varianceAmount: "1.25", receivedQty: "8" })).toBe(10);
    expect(discrepancyValue({ ...base, type: "PRICE_VARIANCE", varianceAmount: "-1" })).toBe(0);
  });

  it("rounds to cents", () => {
    expect(discrepancyValue({ ...base, type: "SHORT", shortageQty: "3", unitPrice: "0.333" })).toBe(1);
  });

  it("has no value without a price", () => {
    expect(discrepancyValue({ ...base, type: "SHORT", shortageQty: "3", unitPrice: null })).toBeNull();
    expect(discrepancyValue({ ...base, type: "PRICE_VARIANCE", varianceAmount: null })).toBeNull();
  });
});

/** The cap of a stored discrepancy: 5 kg ordered at $2, 3 arrived. */
describe("valueOf", () => {
  const line = { shortageQty: "2", orderedQty: "5", receivedQty: "3", varianceAmount: null };

  it("values a plain short at the order price", () => {
    expect(valueOf({ ...line, type: "SHORT", poLineUnitCost: "2", lineActualUnitCost: null })).toBe(4);
  });

  it("values a short on a re-priced line at the higher charged price, not the order price", () => {
    expect(valueOf({ ...line, type: "SHORT", poLineUnitCost: "2", lineActualUnitCost: "4" })).toBe(8);
  });

  it("never values a short below the order price when the door price is lower", () => {
    expect(valueOf({ ...line, type: "SHORT", poLineUnitCost: "2", lineActualUnitCost: "1" })).toBe(4);
  });

  it("falls back to the door price when the order line has none", () => {
    expect(valueOf({ ...line, type: "SHORT", poLineUnitCost: null, lineActualUnitCost: "4" })).toBe(8);
    expect(valueOf({ ...line, type: "SHORT", poLineUnitCost: null, lineActualUnitCost: null })).toBeNull();
  });

  it("values a price rise at the extra per unit times what arrived, whatever the line's prices", () => {
    expect(
      valueOf({ ...line, type: "PRICE_VARIANCE", varianceAmount: "2", poLineUnitCost: "2", lineActualUnitCost: "4" }),
    ).toBe(6);
  });
});
