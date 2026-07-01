import { describe, it, expect } from "vitest";
import { computeMissingLinks } from "./backfillNavPermissions.js";

/**
 * Idempotency is the whole safety property of the rollout backfill: running it
 * twice must not double-grant. These test the pure dedupe that decides which
 * links to insert.
 */

const roles = [{ roleId: 1 }, { roleId: 2 }];
const perms = [{ permissionId: 10 }, { permissionId: 11 }];

describe("computeMissingLinks", () => {
  it("returns the full cartesian product when nothing is linked yet (first run)", () => {
    const missing = computeMissingLinks(roles, perms, []);
    expect(missing).toHaveLength(4);
    expect(missing).toEqual(
      expect.arrayContaining([
        { roleId: 1, permissionId: 10 },
        { roleId: 1, permissionId: 11 },
        { roleId: 2, permissionId: 10 },
        { roleId: 2, permissionId: 11 },
      ]),
    );
  });

  it("returns nothing when every link already exists (idempotent re-run)", () => {
    const existing = [
      { roleId: 1, permissionId: 10 },
      { roleId: 1, permissionId: 11 },
      { roleId: 2, permissionId: 10 },
      { roleId: 2, permissionId: 11 },
    ];
    expect(computeMissingLinks(roles, perms, existing)).toEqual([]);
  });

  it("returns only the links missing after a partial prior run", () => {
    const existing = [
      { roleId: 1, permissionId: 10 },
      { roleId: 2, permissionId: 10 },
    ];
    const missing = computeMissingLinks(roles, perms, existing);
    expect(missing).toEqual(
      expect.arrayContaining([
        { roleId: 1, permissionId: 11 },
        { roleId: 2, permissionId: 11 },
      ]),
    );
    expect(missing).toHaveLength(2);
  });
});
