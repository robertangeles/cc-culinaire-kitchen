/**
 * @module scripts/backfillRosterPermissions
 *
 * One-time rollout helper for Roster Core permissions — same rationale as
 * backfillCompliancePermissions.ts: `seed.ts` only inserts rows that don't
 * already exist, so an existing install's roles never automatically pick up
 * the new `roster:*` mappings until someone reruns the seed or this script.
 * Without this backfill, the moment the enforcing routes deploy AND
 * `roster_enabled` flips on for a pilot org, every existing Subscriber /
 * Paid Subscriber user 403s on Roster Core they were never explicitly denied.
 *
 *   - Administrator: all four (superuser bypass exists, but the row is
 *     listed explicitly, matching every other key already in the seed)
 *   - Subscriber: roster:read-own only
 *   - Paid Subscriber: all four (matches its "full operational access"
 *     tier — same shape as compliance:read-own/read-all/verify)
 * A role whose name doesn't match one of the three above is skipped, same as
 * the seed's mapping loop.
 *
 * MUST run BEFORE the enforcing server code goes live (same window as
 * `db:deploy`). Idempotent: re-running only inserts missing links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillRosterPermissions.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { role, permission, rolePermission } from "../db/schema.js";

const NEW_KEYS = [
  { permissionKey: "roster:read-own", permissionDescription: "View and respond to your own shifts and availability" },
  { permissionKey: "roster:read-all", permissionDescription: "View all shifts, roles, and org-wide availability" },
  { permissionKey: "roster:manage", permissionDescription: "Create and edit roles, shifts, and staff assignments" },
  { permissionKey: "roster:publish", permissionDescription: "Publish a roster, making shifts live" },
];

/** Roster keys granted to a role, keyed by role name — mirrors seed.ts's rolePermMappings. */
const KEYS_BY_ROLE_NAME: Record<string, string[]> = {
  Administrator: ["roster:read-own", "roster:read-all", "roster:manage", "roster:publish"],
  Subscriber: ["roster:read-own"],
  "Paid Subscriber": ["roster:read-own", "roster:read-all", "roster:manage", "roster:publish"],
};

async function main(): Promise<void> {
  for (const p of NEW_KEYS) {
    const existing = await db
      .select({ id: permission.permissionId })
      .from(permission)
      .where(eq(permission.permissionKey, p.permissionKey));
    if (existing.length === 0) {
      await db.insert(permission).values(p);
      console.log(`Inserted permission: ${p.permissionKey}`);
    }
  }

  const allRoles = await db.select({ roleId: role.roleId, roleName: role.roleName }).from(role);
  const allPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing = computeMissingLinks(allRoles, allPerms, existingLinks);

  await db.transaction(async (tx) => {
    for (const link of missing) {
      await tx.insert(rolePermission).values(link);
    }
  });

  console.log(
    `Backfill complete: ${allRoles.length} roles checked, ${missing.length} new role→permission links added.`,
  );
}

/**
 * Pure dedupe: which (role, permission) links are missing and must be inserted.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeMissingLinks(
  allRoles: Array<{ roleId: number; roleName: string }>,
  allPerms: Array<{ permissionId: number; permissionKey: string }>,
  existingLinks: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const missing: Array<{ roleId: number; permissionId: number }> = [];
  for (const r of allRoles) {
    const keys = KEYS_BY_ROLE_NAME[r.roleName];
    if (!keys) continue;
    for (const key of keys) {
      const p = allPerms.find((row) => row.permissionKey === key);
      if (!p) continue;

      const alreadyLinked = existingLinks.some(
        (l) => l.roleId === r.roleId && l.permissionId === p.permissionId,
      );
      if (!alreadyLinked) missing.push({ roleId: r.roleId, permissionId: p.permissionId });
    }
  }
  return missing;
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("backfillRosterPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
