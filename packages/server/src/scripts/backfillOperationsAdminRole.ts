/**
 * @module scripts/backfillOperationsAdminRole
 *
 * One-time rollout helper for the Operations Admin role. `createOrganisation()`
 * now grants Operations Admin to the creator going forward, but every
 * EXISTING org's `user_organisation.role = 'admin'` member never went
 * through that path — without this backfill, the moment this deploys they
 * lose the old ORG_ADMIN_PERMISSIONS bridge (deleted from authService.ts)
 * and gain nothing until they happen to create a brand-new org.
 *
 * Also carries Slice 0's fix: removes the `org:manage-organisation` link
 * from Paid Subscriber, seeded there harmlessly before anything checked
 * that key. It must run in the SAME deploy window as the route change that
 * starts checking it (organisationController.ts's isOrgManager) — reversed
 * order is a live privilege-escalation window.
 *
 * MUST run BEFORE the enforcing server code goes live (same window as
 * `db:deploy`). Idempotent: re-running only inserts missing grants.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillOperationsAdminRole.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { role, permission, rolePermission, userRole, userOrganisation } from "../db/schema.js";

export const OPERATIONS_ADMIN_PERMISSION_KEYS = [
  "chat:access", "chat:unlimited",
  "org:create-organisation", "org:manage-organisation",
  "inventory:count", "inventory:manage", "inventory:transfer", "inventory:hq",
  "purchasing:draft", "purchasing:submit", "purchasing:approve", "purchasing:receive", "purchasing:credit",
  "menu:read", "waste:read", "prep:manage",
  "brain:read", "brain:manage",
  "compliance:read-own", "compliance:read-all", "compliance:verify", "compliance:manage-rules",
  "roster:read-own", "roster:read-all", "roster:manage", "roster:publish",
];

/**
 * Pure dedupe: which distinct users need an Operations Admin `user_role`
 * grant. A user who admins 3 orgs needs exactly one row, not three —
 * `adminUserIds` may contain duplicates, callers pass the raw query result.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeMissingOperationsAdminGrants(
  adminUserIds: number[],
  existingUserRoleRows: Array<{ userId: number; roleId: number }>,
  opsAdminRoleId: number,
): Array<{ userId: number; roleId: number }> {
  const alreadyGranted = new Set(
    existingUserRoleRows.filter((r) => r.roleId === opsAdminRoleId).map((r) => r.userId),
  );
  const distinctAdminUserIds = new Set(adminUserIds);
  const missing: Array<{ userId: number; roleId: number }> = [];
  for (const userId of distinctAdminUserIds) {
    if (!alreadyGranted.has(userId)) missing.push({ userId, roleId: opsAdminRoleId });
  }
  return missing;
}

async function main(): Promise<void> {
  // 1. Ensure the role row exists.
  let [opsAdminRole] = await db.select().from(role).where(eq(role.roleName, "Operations Admin"));
  if (!opsAdminRole) {
    [opsAdminRole] = await db
      .insert(role)
      .values({
        roleName: "Operations Admin",
        roleDescription: "Full operational control of an organisation — everything except role and permission management",
      })
      .returning();
    console.log("Inserted role: Operations Admin");
  }

  // 2. Ensure its 26 permission links exist.
  const allPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const existingRolePerms = await db
    .select({ permissionId: rolePermission.permissionId })
    .from(rolePermission)
    .where(eq(rolePermission.roleId, opsAdminRole.roleId));
  const existingPermIds = new Set(existingRolePerms.map((r) => r.permissionId));

  for (const key of OPERATIONS_ADMIN_PERMISSION_KEYS) {
    const p = allPerms.find((row) => row.permissionKey === key);
    if (!p || existingPermIds.has(p.permissionId)) continue;
    await db.insert(rolePermission).values({ roleId: opsAdminRole.roleId, permissionId: p.permissionId });
    console.log(`Linked Operations Admin → ${key}`);
  }

  // 3. Backfill: every distinct user who admins at least one org.
  const adminMemberships = await db
    .select({ userId: userOrganisation.userId })
    .from(userOrganisation)
    .where(eq(userOrganisation.role, "admin"));
  const existingUserRoles = await db.select({ userId: userRole.userId, roleId: userRole.roleId }).from(userRole);

  const missingGrants = computeMissingOperationsAdminGrants(
    adminMemberships.map((m) => m.userId),
    existingUserRoles,
    opsAdminRole.roleId,
  );

  await db.transaction(async (tx) => {
    for (const grant of missingGrants) {
      await tx.insert(userRole).values(grant);
    }

    // 4. Slice 0 cleanup: strip the Paid Subscriber → org:manage-organisation
    // link seeded before anything checked that key.
    const [paidSubscriber] = await tx.select().from(role).where(eq(role.roleName, "Paid Subscriber"));
    const orgManagePerm = allPerms.find((p) => p.permissionKey === "org:manage-organisation");
    if (paidSubscriber && orgManagePerm) {
      await tx
        .delete(rolePermission)
        .where(and(eq(rolePermission.roleId, paidSubscriber.roleId), eq(rolePermission.permissionId, orgManagePerm.permissionId)));
    }
  });

  console.log(
    `Backfill complete: ${new Set(adminMemberships.map((m) => m.userId)).size} distinct org admins checked, ` +
      `${missingGrants.length} new Operations Admin grants added, Paid Subscriber → org:manage-organisation removed.`,
  );
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("backfillOperationsAdminRole.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
