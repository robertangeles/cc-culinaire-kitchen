import { describe, it, expect } from "vitest";
import { ApiErrorBodySchema, UpgradeRequiredBodySchema, normaliseCode } from "./errors.js";
import { SitePageSchema } from "./legal.js";
import { AuthUserSchema, LocationContextSchema, LoginReplySchema, RefreshReplySchema } from "./auth.js";
import { ActiveSessionSchema, AreaLinesSchema, CountSheetsSchema, SubmitConflictBodySchema } from "./stockTake.js";

// Payloads are shaped like the real server replies. Each lenient rule is one case: the point is that a server
// that moved on (new field, new enum value, new null) does not break a phone that was installed last month.

const user = { userId: 7, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: ["Subscriber"], permissions: ["inventory:count"] };

describe("auth schemas", () => {
  it("ignores fields the phone does not know", () => {
    expect(AuthUserSchema.parse({ ...user, brandNewField: { a: 1 } })).toEqual(user);
  });

  it("only requires what a screen cannot work without", () => {
    expect(AuthUserSchema.parse({ userId: 7 })).toEqual({ userId: 7, userName: "", userEmail: "", mfaEnabled: false, roles: [], permissions: [] });
    expect(AuthUserSchema.safeParse({ userName: "no id" }).success).toBe(false);
  });

  it("reads a password login, an MFA challenge and a rotated or unrotated refresh", () => {
    expect(LoginReplySchema.parse({ user, tokens: { accessToken: "a", refreshToken: "r" } }).tokens?.refreshToken).toBe("r");
    expect(LoginReplySchema.parse({ requiresMfa: true, mfaSessionToken: "m" })).toMatchObject({ requiresMfa: true, mfaSessionToken: "m" });
    expect(RefreshReplySchema.parse({ tokens: { accessToken: "a2" } }).tokens.refreshToken).toBeUndefined();
    expect(RefreshReplySchema.parse({ tokens: { accessToken: "a2", refreshToken: "r2" } }).tokens.refreshToken).toBe("r2");
  });

  it("reads the location context, with null for nothing selected", () => {
    const loc = { storeLocationId: "L1", organisationId: 1, locationName: "Main", classification: "RESTAURANT" };
    expect(LocationContextSchema.parse({ locations: [loc], selectedLocationId: null, organisationId: 1, isOrgAdmin: false, hasLocationAccess: true }).selectedLocationId).toBeNull();
    expect(LocationContextSchema.parse({ locations: [loc] }).hasLocationAccess).toBe(false);
  });
});

describe("stock take schemas", () => {
  const category = { categoryId: "c1", categoryName: "Bar", categoryStatus: "IN_PROGRESS", claimedByUserId: 7, claimedByUserName: "Chef", claimRevision: 2 };

  it("reads the open session, and null when none is open (also an empty body)", () => {
    const session = { sessionId: "s1", sessionStatus: "OPEN", countMode: "AREA", locationName: "Main", categories: [category], extra: true };
    expect(ActiveSessionSchema.parse(session)?.categories[0].claimRevision).toBe(2);
    expect(ActiveSessionSchema.parse(null)).toBeNull();
    expect(ActiveSessionSchema.parse(undefined)).toBeNull();
  });

  it("treats a count mode it does not know as the one the phone cannot count", () => {
    expect(ActiveSessionSchema.parse({ sessionId: "s1", sessionStatus: "OPEN", countMode: "ZONE", categories: [] })?.countMode).toBe("CATEGORY");
  });

  it("keeps a status it does not know as plain text", () => {
    expect(ActiveSessionSchema.parse({ sessionId: "s", sessionStatus: "PAUSED", countMode: "AREA", categories: [{ ...category, categoryStatus: "ON_HOLD", claimRevision: "x" }] })?.categories[0]).toMatchObject({ categoryStatus: "ON_HOLD", claimRevision: 0 });
  });

  it("turns the numeric strings of line quantities into numbers", () => {
    expect(AreaLinesSchema.parse([{ ingredientId: "i1", rawQty: "12.500", countedUnit: "kg", unitCost: "3.2" }])).toEqual([{ ingredientId: "i1", rawQty: 12.5, countedUnit: "kg" }]);
    expect(AreaLinesSchema.parse([{ ingredientId: "i1", rawQty: 3, countedUnit: "L" }])[0].rawQty).toBe(3);
    expect(AreaLinesSchema.safeParse([{ ingredientId: "i1", rawQty: "abc", countedUnit: "L" }]).success).toBe(false);
  });

  it("reads a count sheet whose item lists no other areas", () => {
    const parsed = CountSheetsSchema.parse({ areas: [{ categoryId: "c1", categoryName: "Bar", items: [{ ingredientId: "i1", ingredientName: "Gin", countUnit: "L" }] }] });
    expect(parsed.areas[0].items[0].alsoIn).toEqual([]);
  });

  it("reads the missing list of a submit conflict", () => {
    expect(SubmitConflictBodySchema.parse({ error: "Count these", missing: [{ ingredientId: "i1", ingredientName: "Gin", areaNames: ["Bar"] }] }).missing).toHaveLength(1);
  });
});

describe("error body", () => {
  it("reads a sentence and a code", () => {
    expect(ApiErrorBodySchema.parse({ error: "Nope", code: "ALREADY_CONFIRMED" })).toEqual({ error: "Nope", code: "ALREADY_CONFIRMED" });
  });

  it("reads the older bodies: an error object, no code, a code that is not text, or nothing useful", () => {
    expect(ApiErrorBodySchema.parse({ error: { message: "Bad" } })).toEqual({ error: "Bad", code: undefined });
    expect(ApiErrorBodySchema.parse({ error: "x", code: 7 })).toEqual({ error: "x", code: undefined });
    expect(ApiErrorBodySchema.parse({ error: { issues: [] } })).toEqual({ error: undefined, code: undefined });
  });

  it("compares codes in one spelling", () => {
    expect(normaliseCode(" upgrade_required ")).toBe("UPGRADE_REQUIRED");
  });
});

describe("update-required body (the 426)", () => {
  it("reads the minimum and the store links", () => {
    expect(UpgradeRequiredBodySchema.parse({ error: "Update", code: "upgrade_required", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" } })).toEqual({
      minVersion: "1.2.0",
      storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" },
    });
  });

  it("has no links when the server sent none, and drops a link that is not https (the phone opens what this holds)", () => {
    expect(UpgradeRequiredBodySchema.parse({ minVersion: "1.2.0" }).storeUrls).toBeUndefined();
    expect(UpgradeRequiredBodySchema.parse({ minVersion: "1.2.0", storeUrls: { ios: "javascript:alert(1)", android: "http://play.google.com/x" } }).storeUrls).toEqual({ ios: undefined, android: undefined });
  });

  it("still reads a body with no usable fields: the phone shows the update screen without a version or link", () => {
    expect(UpgradeRequiredBodySchema.parse({ minVersion: 3, storeUrls: "x" })).toEqual({ minVersion: "", storeUrls: undefined });
    expect(UpgradeRequiredBodySchema.parse(undefined)).toEqual({ minVersion: "", storeUrls: undefined });
  });
});

describe("site page (terms, privacy)", () => {
  it("reads the title and the text, and ignores the rest", () => {
    expect(SitePageSchema.parse({ pageId: "p", slug: "terms", surface: "mobile", title: "Terms of Service", bodyMd: "# Hi", publishedInd: true })).toEqual({ title: "Terms of Service", bodyMd: "# Hi" });
  });

  it("needs a title; a missing body is empty text", () => {
    expect(SitePageSchema.parse({ title: "Privacy" })).toEqual({ title: "Privacy", bodyMd: "" });
    expect(SitePageSchema.safeParse({ bodyMd: "x" }).success).toBe(false);
  });
});
