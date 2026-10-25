import { describe, it, expect } from "vitest";
import { isOnlyAdministrator, isRecentSignIn, leavesOrganisationUnmanaged, RECENT_SIGN_IN_MS } from "./accountDeletionService.js";

describe("isOnlyAdministrator", () => {
  it("is true only for the single active Administrator", () => {
    expect(isOnlyAdministrator([7], 7)).toBe(true);
  });
  it("is false when there is another Administrator", () => {
    expect(isOnlyAdministrator([7, 9], 7)).toBe(false);
  });
  it("is false for a non-Administrator, or when there are none", () => {
    expect(isOnlyAdministrator([9], 7)).toBe(false);
    expect(isOnlyAdministrator([], 7)).toBe(false);
  });
});

describe("leavesOrganisationUnmanaged", () => {
  it("blocks the only admin while other members remain", () => {
    expect(leavesOrganisationUnmanaged({ admins: 0, members: 3 })).toBe(true);
  });
  it("allows leaving when another admin remains", () => {
    expect(leavesOrganisationUnmanaged({ admins: 1, members: 3 })).toBe(false);
  });
  it("allows the last member to leave an otherwise empty organisation", () => {
    expect(leavesOrganisationUnmanaged({ admins: 0, members: 0 })).toBe(false);
  });
});

describe("isRecentSignIn", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("accepts a sign-in inside the window, including exactly at its edge", () => {
    expect(isRecentSignIn(ago(60_000), now)).toBe(true);
    expect(isRecentSignIn(ago(RECENT_SIGN_IN_MS), now)).toBe(true);
  });
  it("rejects an older sign-in", () => {
    expect(isRecentSignIn(ago(RECENT_SIGN_IN_MS + 1), now)).toBe(false);
    expect(isRecentSignIn(ago(3 * 24 * 3600 * 1000), now)).toBe(false);
  });
  it("rejects an unknown sign-in time (no or foreign session cookie)", () => {
    expect(isRecentSignIn(null, now)).toBe(false);
  });
});
