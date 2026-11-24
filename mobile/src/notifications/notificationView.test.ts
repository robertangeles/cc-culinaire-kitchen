import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES } from "@culinaire/shared/schemas/push";
import { KNOWN_TYPES, notificationText, phoneRoute, routeFor, timeAgo } from "./notificationView";

const user = (permissions: string[], roles: string[] = []) => ({ userId: 1, userName: "C", userEmail: "c@x.test", mfaEnabled: false, roles, permissions });

describe("notificationText", () => {
  it("has a heading of its own for every type the server writes (the web bell labelled six of them 'Approval needed')", () => {
    expect(KNOWN_TYPES.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    const titles = NOTIFICATION_TYPES.map((type) => notificationText({ type, payload: {} }).title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const type of NOTIFICATION_TYPES) expect(notificationText({ type, payload: {} }).body).not.toBe("");
  });

  it("uses the sentence the producer wrote", () => {
    expect(notificationText({ type: "SHIFT_ASSIGNED", payload: { body: "A shift was assigned to you. Confirm it in My Shifts." } }).body).toBe("A shift was assigned to you. Confirm it in My Shifts.");
    expect(notificationText({ type: "BRAIN_DIGEST", payload: { summary: "12 memories this week" } }).body).toBe("12 memories this week");
  });

  it("builds a sentence from the order number and reason", () => {
    expect(notificationText({ type: "PO_REJECTED", payload: { poNumber: "PO-12", reason: "Over budget" } }).body).toBe("Order PO-12 was not approved: Over budget");
    expect(notificationText({ type: "PO_APPROVED", payload: { poNumber: "PO-12" } }).body).toBe("Order PO-12 was approved.");
  });

  it("names the document and who it belongs to", () => {
    expect(notificationText({ type: "DOCUMENT_EXPIRY_ALERT", payload: { documentType: "Food Safety Supervisor", staffName: "Sam", expiryDate: "1 Dec 2026" } }).body).toBe("Food Safety Supervisor for Sam expires on 1 Dec 2026.");
  });

  it("falls back to the plain sentence when payload fields are missing or not text", () => {
    expect(notificationText({ type: "PO_APPROVED", payload: { poNumber: { nested: true } } }).body).toBe("One of your orders was approved.");
    expect(notificationText({ type: "DOCUMENT_EXPIRY_ALERT", payload: { documentType: "RSA" } }).body).toBe("A compliance document is expiring.");
  });

  it("reads a type this build does not know", () => {
    expect(notificationText({ type: "SOMETHING_NEW", payload: {} })).toEqual({ title: "Notification", body: "You have a new notification." });
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("counts minutes, hours and days", () => {
    expect(timeAgo("2026-11-24T11:59:50Z", now)).toBe("Just now");
    expect(timeAgo("2026-11-24T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-24T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-23T12:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("not a date", now)).toBe("Just now");
  });
});

describe("where a notification opens", () => {
  const n = (type: string, relatedEntityType: string | null = "purchase_order") => ({ notificationId: "n1", type, payload: {}, relatedEntityType, relatedEntityId: "11111111-1111-4111-8111-111111111111", createdAt: "" });

  it("opens the Receive list for an overdue delivery, for someone who can receive", () => {
    expect(routeFor(n("DELIVERY_OVERDUE"), user(["purchasing:receive"]))).toBe("/(app)/(receive)");
    expect(routeFor(n("DELIVERY_OVERDUE"), user([], ["Administrator"]))).toBe("/(app)/(receive)");
    expect(routeFor(n("DELIVERY_OVERDUE"), user(["inventory:count"]))).toBeNull();
  });

  it("opens the order an approval, an answer or a discrepancy is about, for someone who has the Orders tab and may list orders", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    for (const type of ["APPROVAL_REQUIRED", "PO_APPROVED", "PO_REJECTED", "DISCREPANCY_ALERT"]) {
      expect(routeFor(n(type), user(["inventory:count", "purchasing:approve"]))).toBe(`/(app)/(orders)/order?poId=${id}&from=link`);
      expect(routeFor(n(type), user(["purchasing:approve"]))).toBeNull(); // the server would refuse the order itself
      expect(routeFor(n(type), user(["inventory:count"]))).toBeNull();
    }
    expect(routeFor(n("DISCREPANCY_ALERT", "receiving_session"), user([], ["Administrator"]))).toBe("/(app)/(orders)"); // it names a delivery, not an order
  });

  it("has no phone screen yet for shifts, documents or Brain", () => {
    for (const type of ["SHIFT_ASSIGNED", "DOCUMENT_VERIFIED", "BRAIN_NUDGE"]) {
      expect(routeFor(n(type, null), user([], ["Administrator"]))).toBeNull();
    }
  });

  it("never follows a link that is not the server's in-app route", () => {
    expect(phoneRoute("DELIVERY_OVERDUE", "https://evil.example.com", user(["purchasing:receive"]))).toBeNull();
  });
});
