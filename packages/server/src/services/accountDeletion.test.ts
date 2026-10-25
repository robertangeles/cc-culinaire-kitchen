import { describe, it, expect } from "vitest";
import { isOnlyAdministrator, leavesOrganisationUnmanaged } from "./accountDeletionService.js";

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
