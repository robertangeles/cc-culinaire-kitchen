import { describe, it, expect } from "vitest";
import { shouldGrantOperationsAdminRole, shouldRevokeOperationsAdminRole } from "./organisationService.js";

describe("shouldGrantOperationsAdminRole", () => {
  it("grants on a user's first organisation (no existing roles at all)", () => {
    expect(shouldGrantOperationsAdminRole([], 4)).toBe(true);
  });

  it("grants when the user holds other roles but not Operations Admin yet", () => {
    expect(shouldGrantOperationsAdminRole([1, 2], 4)).toBe(true);
  });

  it("refuses a duplicate grant when the user already holds Operations Admin — e.g. creating a second organisation", () => {
    expect(shouldGrantOperationsAdminRole([1, 4], 4)).toBe(false);
  });
});

describe("shouldRevokeOperationsAdminRole", () => {
  it("revokes once the user admins zero organisations", () => {
    expect(shouldRevokeOperationsAdminRole(0)).toBe(true);
  });

  it("keeps the role while the user still admins at least one organisation", () => {
    expect(shouldRevokeOperationsAdminRole(1)).toBe(false);
    expect(shouldRevokeOperationsAdminRole(2)).toBe(false);
  });
});
