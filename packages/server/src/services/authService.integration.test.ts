import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { user, role, userRole, permission, rolePermission } from "../db/schema.js";
import { getUserWithRolesAndPermissions } from "./authService.js";

/**
 * Real-database behaviour of getUserWithRolesAndPermissions's role ordering.
 * Gated on TENANT_IT=1, same convention as roster.integration.test.ts.
 *
 * Regression for the UserMenu "highest role" bug (tasks/lessons.md #75):
 * `roles[]` used to come back in whatever order Postgres's unindexed scan
 * happened to return (no ORDER BY at all) — a UI picking `roles[0]` as "the
 * user's primary role" got an arbitrary one, not the most privileged one.
 * `roles[]` must now be ordered by how many permissions each role actually
 * grants, descending, so `roles[0]` is always the most-privileged role.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `auth_${Date.now().toString(36)}`;

describe.skipIf(!RUN)("getUserWithRolesAndPermissions role ordering (real DB)", () => {
  let userId: number;
  let lowRoleId: number;
  let highRoleId: number;
  let lowPermIds: number[] = [];
  let highPermIds: number[] = [];

  beforeAll(async () => {
    [{ id: userId }] = await db
      .insert(user)
      .values({ userName: `${tag} User`, userEmail: `${tag}@it.test` })
      .returning({ id: user.userId });

    // A low-privilege role (1 permission) and a high-privilege role (3
    // permissions) — deliberately created in an order that does NOT match
    // privilege (low first), so a test that passed by accident (e.g. by
    // insertion order or role_id order) would be caught.
    [{ id: lowRoleId }] = await db
      .insert(role)
      .values({ roleName: `${tag}-low` })
      .returning({ id: role.roleId });
    [{ id: highRoleId }] = await db
      .insert(role)
      .values({ roleName: `${tag}-high` })
      .returning({ id: role.roleId });

    const lowPerm = await db
      .insert(permission)
      .values({ permissionKey: `${tag}:low1` })
      .returning({ id: permission.permissionId });
    lowPermIds = lowPerm.map((p) => p.id);

    const highPerms = await db
      .insert(permission)
      .values([
        { permissionKey: `${tag}:high1` },
        { permissionKey: `${tag}:high2` },
        { permissionKey: `${tag}:high3` },
      ])
      .returning({ id: permission.permissionId });
    highPermIds = highPerms.map((p) => p.id);

    await db.insert(rolePermission).values([
      { roleId: lowRoleId, permissionId: lowPermIds[0] },
      ...highPermIds.map((permissionId) => ({ roleId: highRoleId, permissionId })),
    ]);

    // Assigned low-role first, high-role second — the OLD unordered query
    // would very likely return insertion order here, making a stale test
    // pass for the wrong reason. Assigning low-then-high stress-tests that.
    await db.insert(userRole).values([
      { userId, roleId: lowRoleId },
      { userId, roleId: highRoleId },
    ]);
  });

  afterAll(async () => {
    await db.delete(userRole).where(eq(userRole.userId, userId));
    await db.delete(rolePermission).where(inArray(rolePermission.roleId, [lowRoleId, highRoleId]));
    await db.delete(permission).where(inArray(permission.permissionId, [...lowPermIds, ...highPermIds]));
    await db.delete(role).where(inArray(role.roleId, [lowRoleId, highRoleId]));
    await db.delete(user).where(eq(user.userId, userId));
  });

  it("orders roles[] by permission count descending, regardless of assignment/insertion order", async () => {
    const authUser = await getUserWithRolesAndPermissions(userId);
    expect(authUser.roles).toEqual([`${tag}-high`, `${tag}-low`]);
  });

  it("still returns the full, deduplicated union of permissions across all roles", async () => {
    const authUser = await getUserWithRolesAndPermissions(userId);
    expect(new Set(authUser.permissions)).toEqual(
      new Set([`${tag}:low1`, `${tag}:high1`, `${tag}:high2`, `${tag}:high3`]),
    );
  });
});
