import { describe, it, expect } from "vitest";
import { computeSplitGrants, SPLIT } from "./backfillMenuManagePermission.js";

const perm = (permissionId: number, permissionKey: string) => ({ permissionId, permissionKey });
const perms = [perm(1, "menu:read"), perm(2, "menu:manage"), perm(3, "waste:read")];

describe("computeSplitGrants (menu:read -> menu:manage)", () => {
  it("names the split", () => {
    expect(SPLIT).toEqual({ from: "menu:read", to: "menu:manage" });
  });

  it("gives every role that holds menu:read menu:manage, so nobody loses access", () => {
    const links = [
      { roleId: 10, permissionId: 1 },
      { roleId: 11, permissionId: 1 },
      { roleId: 11, permissionId: 3 },
    ];
    expect(computeSplitGrants(perms, links)).toEqual([
      { roleId: 10, permissionId: 2 },
      { roleId: 11, permissionId: 2 },
    ]);
  });

  it("does not hand it to a role that never held menu:read (a narrowed custom role stays narrow)", () => {
    expect(computeSplitGrants(perms, [{ roleId: 20, permissionId: 3 }])).toEqual([]);
  });

  it("is idempotent: a second run finds nothing to add", () => {
    expect(computeSplitGrants(perms, [{ roleId: 10, permissionId: 1 }, { roleId: 10, permissionId: 2 }])).toEqual([]);
  });

  it("adds nothing while menu:manage is not seeded yet", () => {
    expect(computeSplitGrants([perm(1, "menu:read")], [{ roleId: 10, permissionId: 1 }])).toEqual([]);
  });

  it("counts a role once even if it holds menu:read twice", () => {
    expect(computeSplitGrants(perms, [{ roleId: 10, permissionId: 1 }, { roleId: 10, permissionId: 1 }])).toEqual([{ roleId: 10, permissionId: 2 }]);
  });
});
