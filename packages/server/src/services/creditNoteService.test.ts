import { describe, it, expect } from "vitest";
import { discrepancyValue } from "./creditNoteService.js";

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
