import { describe, it, expect } from "vitest";
import { computeMissingOperationsAdminGrants } from "./backfillOperationsAdminRole.js";

/**
 * Idempotency is the whole safety property of the rollout backfill. This
 * differs from backfillRosterPermissions's computeMissingLinks in one key
 * way: the input is per-USER (a user admining 3 orgs must get exactly ONE
 * grant, not three), not a role→permission cartesian product.
 */

const OPS_ADMIN_ROLE_ID = 4;

describe("computeMissingOperationsAdminGrants", () => {
  it("first run: grants every distinct admin user exactly one row", () => {
    const missing = computeMissingOperationsAdminGrants([1, 2, 3], [], OPS_ADMIN_ROLE_ID);
    expect(missing).toEqual(
      expect.arrayContaining([
        { userId: 1, roleId: OPS_ADMIN_ROLE_ID },
        { userId: 2, roleId: OPS_ADMIN_ROLE_ID },
        { userId: 3, roleId: OPS_ADMIN_ROLE_ID },
      ]),
    );
    expect(missing).toHaveLength(3);
  });

  it("a user who admins multiple orgs (duplicate userIds in input) gets exactly one grant, not one per org", () => {
    const missing = computeMissingOperationsAdminGrants([1, 1, 1, 2], [], OPS_ADMIN_ROLE_ID);
    expect(missing).toEqual(
      expect.arrayContaining([{ userId: 1, roleId: OPS_ADMIN_ROLE_ID }, { userId: 2, roleId: OPS_ADMIN_ROLE_ID }]),
    );
    expect(missing).toHaveLength(2);
  });

  it("idempotent re-run: nothing missing once every admin user already has the grant", () => {
    const existing = [
      { userId: 1, roleId: OPS_ADMIN_ROLE_ID },
      { userId: 2, roleId: OPS_ADMIN_ROLE_ID },
    ];
    expect(computeMissingOperationsAdminGrants([1, 2], existing, OPS_ADMIN_ROLE_ID)).toEqual([]);
  });

  it("partial prior run: only the gap is returned", () => {
    const existing = [{ userId: 1, roleId: OPS_ADMIN_ROLE_ID }];
    const missing = computeMissingOperationsAdminGrants([1, 2], existing, OPS_ADMIN_ROLE_ID);
    expect(missing).toEqual([{ userId: 2, roleId: OPS_ADMIN_ROLE_ID }]);
  });

  it("an existing user_role row for a DIFFERENT role never counts as already-granted", () => {
    // e.g. the user already holds Subscriber (roleId 1) — that must not
    // suppress their Operations Admin grant.
    const existing = [{ userId: 1, roleId: 1 }];
    const missing = computeMissingOperationsAdminGrants([1], existing, OPS_ADMIN_ROLE_ID);
    expect(missing).toEqual([{ userId: 1, roleId: OPS_ADMIN_ROLE_ID }]);
  });
});
