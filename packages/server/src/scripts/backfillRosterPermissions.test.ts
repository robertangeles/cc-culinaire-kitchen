import { describe, it, expect } from "vitest";
import { computeMissingLinks } from "./backfillRosterPermissions.js";

/**
 * Idempotency is the whole safety property of the rollout backfill: running it
 * twice must not double-grant. These test the pure dedupe that decides which
 * links to insert, keyed by role NAME (Administrator/Subscriber/Paid Subscriber),
 * not a blind cartesian product — a role with an unrecognised name must be
 * skipped entirely, matching seed.ts's own rolePermMappings loop.
 */

const roles = [
  { roleId: 1, roleName: "Administrator" },
  { roleId: 2, roleName: "Subscriber" },
  { roleId: 3, roleName: "Paid Subscriber" },
  { roleId: 4, roleName: "Custom BOH Role" },
];

const perms = [
  { permissionId: 10, permissionKey: "roster:read-own" },
  { permissionId: 11, permissionKey: "roster:read-all" },
  { permissionId: 12, permissionKey: "roster:manage" },
  { permissionId: 13, permissionKey: "roster:publish" },
];

describe("computeMissingLinks", () => {
  it("first run: grants each recognised role its full set, skips unrecognised role names", () => {
    const missing = computeMissingLinks(roles, perms, []);
    // Administrator: 4, Subscriber: 1, Paid Subscriber: 4, Custom BOH Role: 0
    expect(missing).toHaveLength(9);
    expect(missing).toEqual(expect.arrayContaining([{ roleId: 2, permissionId: 10 }]));
    expect(missing.some((l) => l.roleId === 4)).toBe(false);
  });

  it("Subscriber only ever gets roster:read-own, never the other three", () => {
    const missing = computeMissingLinks(roles, perms, []);
    const subscriberLinks = missing.filter((l) => l.roleId === 2);
    expect(subscriberLinks).toEqual([{ roleId: 2, permissionId: 10 }]);
  });

  it("idempotent re-run: nothing missing once every link already exists", () => {
    const existing = [
      { roleId: 1, permissionId: 10 },
      { roleId: 1, permissionId: 11 },
      { roleId: 1, permissionId: 12 },
      { roleId: 1, permissionId: 13 },
      { roleId: 2, permissionId: 10 },
      { roleId: 3, permissionId: 10 },
      { roleId: 3, permissionId: 11 },
      { roleId: 3, permissionId: 12 },
      { roleId: 3, permissionId: 13 },
    ];
    expect(computeMissingLinks(roles, perms, existing)).toEqual([]);
  });

  it("partial prior run: only the gap is returned", () => {
    const existing = [{ roleId: 1, permissionId: 10 }];
    const missing = computeMissingLinks(roles, perms, existing);
    expect(missing.some((l) => l.roleId === 1 && l.permissionId === 10)).toBe(false);
    expect(missing.some((l) => l.roleId === 1 && l.permissionId === 11)).toBe(true);
  });
});
