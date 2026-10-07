import { describe, it, expect } from "vitest";
import { computeMissingLinks } from "./backfillCompliancePermissions.js";

/**
 * This script runs against production before the enforcing routes deploy. The
 * properties that matter: each role gets exactly its split and no more (a
 * Subscriber must never gain verify or manage-rules), unknown roles are left
 * alone, and a re-run adds nothing.
 */

const ROLES = [
  { roleId: 1, roleName: "Administrator" },
  { roleId: 2, roleName: "Subscriber" },
  { roleId: 3, roleName: "Paid Subscriber" },
];
const PERMS = [
  { permissionId: 10, permissionKey: "compliance:read-own" },
  { permissionId: 11, permissionKey: "compliance:read-all" },
  { permissionId: 12, permissionKey: "compliance:verify" },
  { permissionId: 13, permissionKey: "compliance:manage-rules" },
];

const keysGrantedTo = (missing: Array<{ roleId: number; permissionId: number }>, roleId: number) =>
  missing
    .filter((l) => l.roleId === roleId)
    .map((l) => PERMS.find((p) => p.permissionId === l.permissionId)!.permissionKey)
    .sort();

describe("computeMissingLinks (compliance)", () => {
  it("gives each role exactly its split on a first run", () => {
    const missing = computeMissingLinks(ROLES, PERMS, []);
    expect(keysGrantedTo(missing, 1)).toEqual([
      "compliance:manage-rules",
      "compliance:read-all",
      "compliance:read-own",
      "compliance:verify",
    ]);
    expect(keysGrantedTo(missing, 2)).toEqual(["compliance:read-own"]);
    expect(keysGrantedTo(missing, 3)).toEqual(["compliance:read-all", "compliance:read-own", "compliance:verify"]);
  });

  it("never grants manage-rules to Paid Subscriber, nor verify or read-all to Subscriber", () => {
    const missing = computeMissingLinks(ROLES, PERMS, []);
    const paid = keysGrantedTo(missing, 3);
    const subscriber = keysGrantedTo(missing, 2);
    expect(paid).not.toContain("compliance:manage-rules");
    expect(subscriber).not.toContain("compliance:verify");
    expect(subscriber).not.toContain("compliance:read-all");
  });

  it("skips a role whose name is not one of the three", () => {
    const missing = computeMissingLinks([{ roleId: 9, roleName: "Operations Admin" }], PERMS, []);
    expect(missing).toEqual([]);
  });

  it("returns nothing on a re-run once every link exists", () => {
    const first = computeMissingLinks(ROLES, PERMS, []);
    expect(computeMissingLinks(ROLES, PERMS, first)).toEqual([]);
  });

  it("returns only the links missing after a partial prior run", () => {
    const missing = computeMissingLinks(ROLES, PERMS, [{ roleId: 2, permissionId: 10 }]);
    expect(keysGrantedTo(missing, 2)).toEqual([]);
    expect(keysGrantedTo(missing, 3)).toHaveLength(3);
  });

  it("skips a permission key that has no row yet instead of inventing a link", () => {
    const withoutVerify = PERMS.filter((p) => p.permissionKey !== "compliance:verify");
    const missing = computeMissingLinks(ROLES, withoutVerify, []);
    expect(keysGrantedTo(missing, 3)).toEqual(["compliance:read-all", "compliance:read-own"]);
  });
});
