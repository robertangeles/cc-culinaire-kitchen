import { describe, it, expect } from "vitest";
import { ApiError } from "../api/client";
import {
  allGood,
  confirmedMessage,
  expectedLabel,
  failureMessage,
  finishedElsewhere,
  formatQty,
  issueCount,
  lineSummary,
  priceInput,
  rejectInput,
  shortInput,
  type ReceivingLine,
} from "./receivingFlow";

const line = (over: Partial<ReceivingLine> = {}): ReceivingLine => ({
  receivingLineId: "r1",
  poLineId: "pl1",
  ingredientId: "i1",
  ingredientName: "Flour",
  orderedQty: "5.0000",
  orderedUnit: "kg",
  receivedQty: "5.0000",
  actualUnitCost: "2.0000",
  status: "RECEIVED",
  ...over,
});

describe("formatQty", () => {
  it.each([["5.0000", "5"], ["2.50", "2.5"], ["0.125", "0.125"], [3, "3"]])("%j -> %s", (v, out) => expect(formatQty(v)).toBe(out));
});

describe("short", () => {
  it("needs a quantity", () => expect(shortInput("", line())).toMatchObject({ ok: false }));
  it.each(["5", "7"])("refuses %s of 5 ordered, because that is not short", (q) => {
    const r = shortInput(q, line());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("less than the 5 kg ordered");
  });
  it("accepts zero and anything under the order", () => {
    expect(shortInput("0", line())).toEqual({ ok: true, value: { status: "SHORT", receivedQty: "0" } });
    expect(shortInput("3.5", line())).toEqual({ ok: true, value: { status: "SHORT", receivedQty: "3.5" } });
  });
});

describe("price change", () => {
  it("needs the price", () => expect(priceInput("")).toMatchObject({ ok: false }));
  it("carries the price", () => expect(priceInput("3.2")).toEqual({ ok: true, value: { status: "PRICE_VARIANCE", actualUnitCost: "3.2" } }));
});

describe("reject", () => {
  it("omits an empty note and trims a long one", () => {
    expect(rejectInput("damaged", "  ")).toEqual({ status: "REJECTED", rejectionReason: "damaged" });
    expect(rejectInput("other", "x".repeat(600)).rejectionNote).toHaveLength(500);
  });
});

describe("all good", () => {
  it("sends the status alone, as the web does: the server puts the quantity and price back", () => {
    expect(allGood).toEqual({ status: "RECEIVED" });
  });
});

describe("line words", () => {
  it("says what happened in plain words", () => {
    expect(lineSummary(line(), "2")).toBe("5 kg");
    expect(lineSummary(line({ status: "SHORT", receivedQty: "3" }), "2")).toBe("Short: 3 of 5 kg");
    expect(lineSummary(line({ status: "REJECTED", receivedQty: "0" }), "2")).toBe("Rejected: 5 kg");
    expect(lineSummary(line({ status: "PRICE_VARIANCE", actualUnitCost: "3" }), "2")).toBe("5 kg, price now $3.00/kg");
  });
  // The server keeps one status per line but both fields: the row must not hide either.
  it("a line flagged short and then repriced reads as both", () => {
    expect(lineSummary(line({ status: "PRICE_VARIANCE", receivedQty: "3", actualUnitCost: "4" }), "2")).toBe("Short: 3 of 5 kg, price now $4.00/kg");
  });
  it("a line repriced and then flagged short reads as both", () => {
    expect(lineSummary(line({ status: "SHORT", receivedQty: "3", actualUnitCost: "4" }), "2")).toBe("Short: 3 of 5 kg, price now $4.00/kg");
  });
  it("a price on a line the order had no price for is a changed price", () => {
    expect(lineSummary(line({ status: "PRICE_VARIANCE", actualUnitCost: "4" }), null)).toBe("5 kg, price now $4.00/kg");
    expect(lineSummary(line({ actualUnitCost: null }), null)).toBe("5 kg");
  });
  it("counts the flagged lines", () => {
    expect(issueCount([line(), line({ status: "SHORT" }), line({ status: "REJECTED" })])).toBe(2);
  });
});

describe("errors", () => {
  const unit = new ApiError("bad_request", "Cannot receive Tomatoes (case to kg): no conversion.", 400, undefined, "UNIT_NOT_CONVERTIBLE");
  it("keeps the server's sentence for an unconvertible unit", () => expect(failureMessage(unit)).toContain("Tomatoes"));
  it("uses the client's wording for an offline phone", () => expect(failureMessage(new ApiError("network"))).toBe("Can't reach the server. Try again."));
  it("tells a refused permission apart", () => expect(failureMessage(new ApiError("forbidden"))).toContain("permission"));
  it("recognises a delivery that was already confirmed", () => {
    expect(finishedElsewhere(new ApiError("conflict", "x", 409, undefined, "ALREADY_CONFIRMED"))?.message).toContain("already confirmed");
  });
  it("tells a delivery cancelled on another phone apart from a confirmed one", () => {
    const cancelled = finishedElsewhere(new ApiError("conflict", "Cannot transition receiving session from CANCELLED to COMPLETED", 409, undefined, "INVALID_STATE"));
    expect(cancelled?.message).toContain("cancelled");
    expect(cancelled?.message).not.toContain("confirmed");
  });
  it("does not call any other refusal finished", () => {
    expect(finishedElsewhere(new ApiError("conflict", "x", 409))).toBeNull();
    expect(finishedElsewhere(new ApiError("network"))).toBeNull();
  });
});

describe("confirmed message", () => {
  it("a perfect delivery", () => expect(confirmedMessage({ poStatus: "RECEIVED", discrepancyCount: 0, isPerfectDelivery: true }).title).toBe("Delivery received"));
  it("a short delivery says the order is closed and the balance needs a new PO", () => {
    const m = confirmedMessage({ poStatus: "PARTIAL_RECEIVED", discrepancyCount: 2, isPerfectDelivery: false });
    expect(m.detail).toContain("2 issues");
    expect(m.detail).toContain("new purchase order");
  });
  it("a price-only change keeps the order complete", () => {
    expect(confirmedMessage({ poStatus: "RECEIVED", discrepancyCount: 1, isPerfectDelivery: false }).detail).toBe("1 issue recorded. Stock is updated.");
  });
});

describe("expectedLabel", () => {
  const now = new Date(2026, 10, 22, 9, 0);
  it("is null with no date", () => expect(expectedLabel(null, now)).toBeNull());
  it("names today, tomorrow and overdue", () => {
    expect(expectedLabel(new Date(2026, 10, 22, 23).toISOString(), now)).toBe("Expected today");
    expect(expectedLabel(new Date(2026, 10, 23, 6).toISOString(), now)).toBe("Expected tomorrow");
    expect(expectedLabel(new Date(2026, 10, 20, 6).toISOString(), now)).toBe("Overdue");
  });
});
