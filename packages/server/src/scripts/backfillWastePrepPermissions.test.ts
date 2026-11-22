import { describe, it, expect } from "vitest";
import { computeSplitGrants, SPLITS } from "./backfillWastePrepPermissions.js";

const perm = (permissionId: number, permissionKey: string) => ({ permissionId, permissionKey });
const perms = [perm(1, "waste:read"), perm(2, "prep:manage"), perm(3, "waste:log"), perm(4, "prep:read")];

describe("computeSplitGrants", () => {
  it("names the two splits: waste:read -> waste:log, prep:manage -> prep:read", () => {
    expect(SPLITS).toEqual([
      { from: "waste:read", to: "waste:log" },
      { from: "prep:manage", to: "prep:read" },
    ]);
  });

  it("gives every role that holds the old key the new one, so nobody loses access", () => {
    const links = [
      { roleId: 10, permissionId: 1 },
      { roleId: 11, permissionId: 2 },
      { roleId: 12, permissionId: 1 },
      { roleId: 12, permissionId: 2 },
    ];
    expect(computeSplitGrants(perms, links)).toEqual(
      expect.arrayContaining([
        { roleId: 10, permissionId: 3 },
        { roleId: 11, permissionId: 4 },
        { roleId: 12, permissionId: 3 },
        { roleId: 12, permissionId: 4 },
      ]),
    );
    expect(computeSplitGrants(perms, links)).toHaveLength(4);
  });

  it("does not hand the new key to a role that never held the old one (a narrowed custom role stays narrow)", () => {
    expect(computeSplitGrants(perms, [{ roleId: 20, permissionId: 99 }])).toEqual([]);
  });

  it("is idempotent: a second run finds nothing to add", () => {
    const links = [
      { roleId: 10, permissionId: 1 },
      { roleId: 10, permissionId: 3 },
    ];
    expect(computeSplitGrants(perms, links)).toEqual([]);
  });
});
