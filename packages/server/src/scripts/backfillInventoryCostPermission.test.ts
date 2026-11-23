import { describe, it, expect } from "vitest";
import { computeCostGrants } from "./backfillInventoryCostPermission.js";

const perm = (permissionId: number, permissionKey: string) => ({ permissionId, permissionKey });
const perms = [perm(1, "inventory:count"), perm(2, "inventory:manage"), perm(3, "inventory:hq"), perm(4, "inventory:cost"), perm(5, "waste:log")];

describe("computeCostGrants", () => {
  it("gives inventory:cost to every role holding any inventory key, once, so nobody loses what they see today", () => {
    const links = [
      { roleId: 10, permissionId: 1 },
      { roleId: 10, permissionId: 2 },
      { roleId: 11, permissionId: 3 },
      { roleId: 12, permissionId: 2 },
    ];
    expect(computeCostGrants(perms, links)).toEqual([
      { roleId: 10, permissionId: 4 },
      { roleId: 11, permissionId: 4 },
      { roleId: 12, permissionId: 4 },
    ]);
  });

  it("leaves a role with no inventory key alone", () => {
    expect(computeCostGrants(perms, [{ roleId: 20, permissionId: 5 }])).toEqual([]);
  });

  it("is idempotent: a second run finds nothing to add", () => {
    const links = [
      { roleId: 10, permissionId: 1 },
      { roleId: 10, permissionId: 4 },
    ];
    expect(computeCostGrants(perms, links)).toEqual([]);
  });

  it("does nothing before the key exists", () => {
    expect(computeCostGrants(perms.filter((p) => p.permissionKey !== "inventory:cost"), [{ roleId: 10, permissionId: 1 }])).toEqual([]);
  });
});
