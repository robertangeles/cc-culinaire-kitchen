import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_TYPES,
  PUSH_LINK_PATTERN,
  PushPreferencesUpdateSchema,
  PushDataSchema,
  pushLink,
} from "./push.js";

const ID = "3f2b8c1e-5d7a-4e6f-9a1b-2c3d4e5f6a7b";

describe("pushLink", () => {
  it("gives every notification type a route the phone can match, with and without a related entity", () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const link of [pushLink(type), pushLink(type, "shift", ID), pushLink(type, "purchase_order", ID), pushLink(type, "compliance_document", ID)]) {
        expect(link, type).toMatch(PUSH_LINK_PATTERN);
      }
    }
  });

  it("opens the record the notification is about when the entity is the right kind", () => {
    expect(pushLink("SHIFT_ASSIGNED", "shift", ID)).toBe(`/shifts/${ID}`);
    expect(pushLink("SHIFT_CHANGED", "shift", ID)).toBe(`/shifts/${ID}`);
    expect(pushLink("DOCUMENT_REJECTED", "compliance_document", ID)).toBe(`/compliance/documents/${ID}`);
    expect(pushLink("PO_APPROVED", "purchase_order", ID)).toBe(`/purchasing/orders/${ID}`);
  });

  it("falls back to the list when the entity is missing, of another kind, or not an id", () => {
    expect(pushLink("SHIFT_ASSIGNED")).toBe("/shifts");
    expect(pushLink("SHIFT_ASSIGNED", "purchase_order", ID)).toBe("/shifts");
    expect(pushLink("SHIFT_ASSIGNED", "shift", "../../etc")).toBe("/shifts");
    expect(pushLink("DOCUMENT_VERIFIED", "compliance_document", "x y")).toBe("/compliance");
  });

  it("sends a cancelled shift to the list, since the shift is no longer in My Shifts", () => {
    expect(pushLink("SHIFT_CANCELLED", "shift", ID)).toBe("/shifts");
  });

  it("sends a type it does not know, from a newer server, to the inbox", () => {
    expect(pushLink("SOMETHING_NEW", "shift", ID)).toBe("/notifications");
  });
});

describe("PushDataSchema", () => {
  it("reads what the server puts in a push and refuses a link that is not an in-app route", () => {
    const ok = PushDataSchema.safeParse({ notificationId: ID, type: "SHIFT_ASSIGNED", link: `/shifts/${ID}` });
    expect(ok.success).toBe(true);
    expect(PushDataSchema.safeParse({ notificationId: ID, type: "X", link: "https://evil.example/" }).success).toBe(false);
    expect(PushDataSchema.safeParse({ notificationId: ID, type: "X", link: "//evil.example" }).success).toBe(false);
  });
});

describe("PushPreferencesUpdateSchema", () => {
  it("accepts a partial update", () => {
    expect(PushPreferencesUpdateSchema.safeParse({}).success).toBe(true);
    expect(PushPreferencesUpdateSchema.safeParse({ disabledTypes: ["SHIFT_CHANGED"] }).success).toBe(true);
    expect(PushPreferencesUpdateSchema.safeParse({ quietHours: null }).success).toBe(true);
    expect(PushPreferencesUpdateSchema.safeParse({ quietHours: { start: "22:00", end: "07:00", timeZone: "Australia/Sydney" } }).success).toBe(true);
  });

  it("refuses malformed times, equal start and end, and unknown types", () => {
    const bad = (v: unknown) => PushPreferencesUpdateSchema.safeParse(v).success;
    expect(bad({ quietHours: { start: "24:00", end: "07:00", timeZone: "UTC" } })).toBe(false);
    expect(bad({ quietHours: { start: "9:00", end: "07:00", timeZone: "UTC" } })).toBe(false);
    expect(bad({ quietHours: { start: "22:00", end: "22:00", timeZone: "UTC" } })).toBe(false);
    expect(bad({ quietHours: { start: "22:00", end: "07:00" } })).toBe(false);
    expect(bad({ disabledTypes: ["NOT_A_TYPE"] })).toBe(false);
    expect(bad({ disabledTypes: "SHIFT_CHANGED" })).toBe(false);
  });
});
