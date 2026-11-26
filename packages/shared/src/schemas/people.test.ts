import { describe, it, expect } from "vitest";
import { AvailabilityListSchema, MyShiftsSchema, OpenSwapsSchema } from "./roster.js";
import { MyDocumentsSchema, UploadReplySchema, ViewUrlSchema } from "./compliance.js";
import { StoreLocationSchema } from "./auth.js";

const shift = { shiftId: "s1", assignmentId: "a1", storeLocationId: "L1", locationName: "Bar", ianaTimezone: "Australia/Perth", state: "WA", rosterRoleId: "r", roleName: "Chef", startDatetime: "2026-11-30T01:00:00.000Z", endDatetime: "2026-11-30T09:00:00.000Z", status: "Published", isPublicHoliday: false, assignmentStatus: "Pending", publicHolidayConsent: null };

describe("the roster rows the phone reads", () => {
  it("reads a shift and survives fields an older or newer server changes", () => {
    expect(MyShiftsSchema.parse([shift])[0]).toMatchObject({ assignmentId: "a1", ianaTimezone: "Australia/Perth" });
    const { ianaTimezone: _z, isPublicHoliday: _p, ...older } = shift;
    expect(MyShiftsSchema.parse([{ ...older, publicHolidayConsent: undefined }])[0]).toMatchObject({ ianaTimezone: "", isPublicHoliday: false, publicHolidayConsent: null });
  });

  it("leaves out a row it cannot use instead of losing the list", () => {
    expect(MyShiftsSchema.parse([{ shiftId: 4 }, shift])).toHaveLength(1);
    expect(OpenSwapsSchema.parse([null, { swapRequestId: "w", shiftId: "s", fromAssignmentId: "a", fromUserId: 2, startDatetime: "x", endDatetime: "y", storeLocationId: "L" }])).toHaveLength(1);
    const row = { swapRequestId: "w", shiftId: "s", fromAssignmentId: "a", fromUserId: 2, startDatetime: "x", endDatetime: "y", storeLocationId: "L" };
    expect(OpenSwapsSchema.parse([{ ...row, shiftStatus: "Draft", ianaTimezone: "Australia/Perth", locationName: "Bar" }, { ...row, shiftStatus: 4, ianaTimezone: null }])).toMatchObject([{ shiftStatus: "Draft", ianaTimezone: "Australia/Perth", locationName: "Bar" }, { shiftStatus: undefined, ianaTimezone: undefined }]);
    expect(AvailabilityListSchema.parse([{ staffAvailabilityId: "v", dayOfWeek: 9 }])).toEqual([]);
  });

  it("keeps the venue's zone on a location, and reads one saved without it", () => {
    const loc = { storeLocationId: "L1", organisationId: 1, locationName: "Bar" };
    expect(StoreLocationSchema.parse({ ...loc, ianaTimezone: "Australia/Perth" }).ianaTimezone).toBe("Australia/Perth");
    expect(StoreLocationSchema.parse(loc).ianaTimezone).toBeUndefined();
  });
});

describe("the documents the phone reads", () => {
  it("reads only the fields the person's own screens show", () => {
    const [doc] = MyDocumentsSchema.parse([{ complianceDocumentId: "d1", documentType: "RSA", verificationStatus: "Pending", anythingElse: "x", uploadedAt: "2026-11-01T00:00:00Z" }]);
    expect(doc).not.toHaveProperty("anythingElse");
    expect(doc.storagePublicId).toBeNull();
  });

  it("reads an upload with no text found on it", () => {
    expect(UploadReplySchema.parse({ storagePublicId: "p", storageFormat: "jpg" }).ocr).toEqual({});
  });

  it("opens https links only", () => {
    expect(ViewUrlSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(ViewUrlSchema.safeParse({ url: "http://x.test/f" }).success).toBe(false);
    expect(ViewUrlSchema.safeParse({ url: "https://x.test/f" }).success).toBe(true);
  });
});
