import { describe, it, expect } from "vitest";
import { DiscrepancySchema, OrderDetailSchema, OrderLineSchema, OrderSummarySchema, type Discrepancy, type OrderLine, type OrderSummary } from "@culinaire/shared/schemas/purchasing";
import { ApiError } from "../api/client";
import type { AuthUser } from "../api/auth";
import { SuggestionLineSchema, SupplierSchema } from "@culinaire/shared/schemas/purchasing";
import { byWait, calendarDay, creditAmount, dialable, discrepancyText, FILTERS, lineFacts, money, orderActions, orderFailure, orderRights, receipt, statusLabel, stockAgainstPar, suggestedOrder, supplierFacts, waiting } from "./orderView";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const person = (permissions: string[], roles: string[] = []): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles, permissions });
const order = (over: object = {}): OrderSummary => OrderSummarySchema.parse({ poId: "p1", poNumber: "PO-1", status: "DRAFT", storeLocationId: "L1", supplierId: "s1", ...over });
const line = (over: object = {}): OrderLine => OrderLineSchema.parse({ lineId: "l1", ingredientId: "i1", ingredientName: "Flour", orderedQty: "2.0000", orderedUnit: "bag", unitCost: "17.5", lineStatus: "PENDING", ...over });
const disc = (over: object = {}): Discrepancy => DiscrepancySchema.parse({ discrepancyId: "d1", type: "SHORT", poId: "p1", supplierId: "s1", orderedQty: "5", orderedUnit: "kg", shortageQty: "2", ...over });
const all = orderRights(person([], ["Administrator"]));

describe("what a person may do", () => {
  it("follows the key each server route asks for", () => {
    expect(orderRights(person(["inventory:count", "purchasing:draft", "purchasing:receive"]))).toEqual({ list: true, create: false, submit: false, approve: false, receive: true, draft: true, credit: false, suppliers: true, suggestions: false });
    expect(orderRights(person(["inventory:count", "inventory:manage", "purchasing:submit"]))).toMatchObject({ create: true, submit: true, approve: false });
    expect(orderRights(person(["purchasing:credit"]))).toMatchObject({ list: false, credit: true, suppliers: false });
    expect(orderRights(person(["inventory:manage"]))).toMatchObject({ suggestions: true });
    expect(Object.values(all).every(Boolean)).toBe(true);
  });
});

describe("the buttons an order offers", () => {
  const on = (o: OrderSummary, rights = all) => Object.entries(orderActions(o, rights, NOW)).filter(([, v]) => v).map(([k]) => k);

  it("are the web's, by status", () => {
    expect(on(order())).toEqual(["edit", "submit", "cancel", "pdf"]);
    expect(on(order({ status: "PENDING_APPROVAL", canApprove: true }))).toEqual(["approve", "reject", "pdf"]);
    expect(on(order({ status: "SENT", supplierOrderingMethod: "email" }))).toEqual(["receive", "email", "pdf"]);
    expect(on(order({ status: "RECEIVING" }))).toEqual(["receive", "pdf"]);
    expect(on(order({ status: "RECEIVED" }))).toEqual(["reorder"]);
    expect(on(order({ status: "PARTIAL_RECEIVED" }))).toEqual(["reorder"]);
    expect(on(order({ status: "CANCELLED" }))).toEqual([]);
    expect(on(order({ status: "ON_HOLD" }))).toEqual([]);
  });

  it("offer no Approve on an approver's own order while someone else can approve it, as the server says, but still Reject", () => {
    expect(on(order({ status: "PENDING_APPROVAL", canApprove: false }))).toEqual(["approveBlocked", "reject", "pdf"]);
  });

  it("leave out what the person's permissions would be refused on", () => {
    const cook = orderRights(person(["inventory:count", "purchasing:draft"]));
    expect(on(order(), cook)).toEqual([]);
    expect(on(order({ status: "PENDING_APPROVAL" }), cook)).toEqual([]);
    expect(on(order({ status: "SENT" }), cook)).toEqual([]);
    expect(on(order({ status: "RECEIVED" }), cook)).toEqual(["reorder"]);
  });

  it("email only a supplier that takes email, and not again inside the server's window", () => {
    expect(on(order({ status: "SENT", supplierOrderingMethod: "phone" }))).toEqual(["receive", "pdf"]);
    expect(on(order({ status: "SENT", supplierOrderingMethod: null }))).toContain("email"); // opened from a notification: the server answers for it
    expect(on(order({ status: "SENT", supplierOrderingMethod: "email", supplierEmailedAt: "2026-11-25T11:58:00Z" }))).toEqual(["receive", "pdf"]);
    expect(on(order({ status: "SENT", supplierOrderingMethod: "email", supplierEmailedAt: "2026-11-25T11:50:00Z" }))).toContain("email");
  });
});

describe("suppliers and reorder suggestions", () => {
  it("dial only what the dialler takes, and nothing for a number with no digits", () => {
    expect(dialable("+61 (3) 9000-1234 ext. 2")).toBe("+613900012342");
    expect(dialable("1300 FARMS")).toBe("1300");
    expect(dialable("ask at the counter")).toBeNull();
    expect(dialable(null)).toBeNull();
  });

  it("put a supplier's terms in the web's words, leaving out what is not set and showing a key this version does not know", () => {
    expect(supplierFacts(SupplierSchema.parse({ supplierId: "s", supplierName: "A", deliveryDays: "tue, sat,xmas", leadTimeDays: 1, orderingMethod: "fax", paymentTerms: "net_90" }))).toEqual(["Delivers Tue, Sat, xmas", "1 day lead time", "Order by fax", "net_90"]);
    expect(supplierFacts(SupplierSchema.parse({ supplierId: "s", supplierName: "A" }))).toEqual([]);
  });

  it("order whole packages where an item is bought in them, else the kitchen unit", () => {
    const line = (over: object) => SuggestionLineSchema.parse({ ingredientId: "i", ingredientName: "Flour", baseUnit: "kg", suggestedQty: 21, ...over });
    expect(suggestedOrder(line({ purchaseUnit: "bag", packQty: 12.5, suggestedPackages: 2 }))).toBe("2 bag (25 kg)");
    expect(suggestedOrder(line({ purchaseUnit: "bag", suggestedPackages: 2 }))).toBe("2 bag");
    expect(suggestedOrder(line({}))).toBe("21 kg");
    expect(suggestedOrder(line({ suggestedQty: undefined }))).toBeNull();
    expect(stockAgainstPar(line({ currentQty: 0, parLevel: "25" }))).toBe("On hand 0 kg, par 25 kg");
    expect(stockAgainstPar(line({}))).toBe("");
  });
});

describe("what an order says", () => {
  it("names each status, and shows one it does not know as it is", () => {
    expect(["DRAFT", "PENDING_APPROVAL", "PARTIAL_RECEIVED", "ON_HOLD"].map(statusLabel)).toEqual(["Draft", "Pending approval", "Part received", "ON_HOLD"]);
  });

  it("filters as the web does, with the part-received ones under Received", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(["All", "Draft", "Pending", "Sent", "Receiving", "Received", "Cancelled"]);
    expect(FILTERS.find((f) => f.label === "Received")!.statuses).toEqual(["RECEIVED", "PARTIAL_RECEIVED"]);
  });

  it("says how long it has waited: amber over a day, red over two", () => {
    const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    expect(waiting(at(0.2), NOW)).toEqual({ label: "Waiting under an hour", tone: "calm" });
    expect(waiting(at(24), NOW)).toEqual({ label: "Waiting 24 h", tone: "calm" });
    expect(waiting(at(25), NOW)).toEqual({ label: "Waiting 25 h", tone: "amber" });
    expect(waiting(at(49), NOW)).toEqual({ label: "Waiting 49 h", tone: "red" });
    expect(waiting(null, NOW)).toBeNull();
  });

  it("lists the longest wait first", () => {
    expect(byWait([order({ poId: "new", submittedAt: "2026-11-25T01:00:00Z" }), order({ poId: "old", submittedAt: "2026-11-20T01:00:00Z" })]).map((o) => o.poId)).toEqual(["old", "new"]);
  });

  it("shows no figure where the server sent none, never zero", () => {
    expect(money(null)).toBeNull();
    expect(lineFacts(line({ unitCost: undefined })).price).toBeNull();
    expect(lineFacts(line({ unitCost: undefined })).paid).toBeNull();
  });

  it("shows a line's order, what came and a price that changed at the door", () => {
    expect(lineFacts(line())).toEqual({ ordered: "2 bag", received: null, price: "$17.50 per bag", paid: null, status: null });
    expect(lineFacts(line({ receivedQty: "1.5", actualUnitCost: "18", lineStatus: "SHORT" }))).toMatchObject({ received: "1.5 received", paid: { text: "paid $18.00", up: true }, status: "Short" });
    expect(lineFacts(line({ actualUnitCost: "17.5000" })).paid).toBeNull();
  });

  it("says who signed for the delivery", () => {
    const d = (over: object) => OrderDetailSchema.parse({ ...order(), lines: [{ ...line(), ...over }] });
    expect(receipt(d({}))).toBeNull();
    expect(receipt(d({ receivedDttm: "2026-11-20T01:00:00Z", receivedByUserName: "Sam" }))).toMatch(/^Received by Sam on /);
  });

  it("reads an expected delivery as the calendar day it is, in any time zone", () => {
    expect(calendarDay("2026-11-26T00:00:00.000Z")).toMatch(/26/);
    expect(calendarDay(null)).toBeNull();
  });

  it("says what was wrong with a delivery", () => {
    expect(discrepancyText(disc())).toBe("Short: 2 kg missing of 5 kg");
    expect(discrepancyText(disc({ type: "REJECTED", rejectionReason: "damaged" }))).toBe("Rejected: damaged");
    expect(discrepancyText(disc({ type: "REJECTED", rejectionReason: "other", rejectionNote: "Torn bag" }))).toBe("Rejected: Torn bag");
    expect(discrepancyText(disc({ type: "PRICE_VARIANCE", poUnitCost: "2", actualUnitCost: "3" }))).toBe("Price changed: $2.00 ordered, $3.00 charged");
    expect(discrepancyText(disc({ type: "SUBSTITUTION" }))).toBe("Substituted: 5 kg ordered");
    expect(discrepancyText(disc({ type: "NEW_KIND" }))).toBe("NEW_KIND");
  });
});

describe("what went wrong", () => {
  it("says a write needs a connection, and that the request may have landed", () => {
    expect(orderFailure(new ApiError("network"), "Sending an order")).toEqual({ message: "Can't reach the server. Sending an order needs a connection.", unsure: true, moved: false });
    expect(orderFailure(new ApiError("timeout"), "Sending an order").unsure).toBe(true);
  });

  it("goes by the server's code: an order that moved on, someone else's to approve, an email just sent", () => {
    expect(orderFailure(new ApiError("conflict", "Cannot approve PO with status SENT", 409, undefined, "INVALID_STATE"), "x").moved).toBe(true);
    expect(orderFailure(new ApiError("forbidden", "You created this purchase order, so another approver must approve it.", 403, undefined, "SELF_APPROVAL_NOT_ALLOWED"), "x").message).toContain("another approver");
    expect(orderFailure(new ApiError("conflict", "This order was just emailed to the supplier.", 409, undefined, "ALREADY_EMAILED"), "x").message).toContain("just emailed");
    expect(orderFailure(new ApiError("forbidden", "Insufficient permissions", 403), "x").message).toBe("You don't have permission for that.");
    expect(orderFailure(new ApiError("forbidden", "Insufficient permissions", 403, undefined, "FORBIDDEN"), "x").message).toBe("You don't have permission for that.");
  });

  it("a mail provider's failure is certain (nothing was sent); a bare 5xx is not", () => {
    expect(orderFailure(new ApiError("server", "The email could not be sent", 502, undefined, "EMAIL_FAILED"), "x").unsure).toBe(false);
    expect(orderFailure(new ApiError("server", undefined, 500), "x").unsure).toBe(true);
  });
});

describe("the credit to claim", () => {
  it("is at least a cent, kept to the cent, and no more than the discrepancy is worth", () => {
    expect(creditAmount("8", 8)).toEqual({ ok: true, value: 8 });
    expect(creditAmount("7,50", 8)).toEqual({ ok: true, value: 7.5 });
    expect(creditAmount("$7.999", 8)).toEqual({ ok: true, value: 8 });
    expect(creditAmount("8.01", 8)).toEqual({ ok: false, message: "The credit can't be more than $8.00, what this is worth." });
    for (const bad of ["", "0", "0.001", "-1", "abc"]) expect(creditAmount(bad, 8).ok).toBe(false);
  });
});
