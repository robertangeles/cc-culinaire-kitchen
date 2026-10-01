/**
 * @module scripts/backfillSalesPermissions
 *
 * One-time rollout helper for the Front-of-House sales feature.
 *
 * The FOH routes (`/locations/:locId/foh/*`, `/locations/:locId/sales`) are
 * NEW and gated by two new permissions: `sales:record` and `sales:read`.
 * On a fresh DB the seed grants them to the default operator roles. On an
 * EXISTING install (prod) the seed may not re-run, so this script inserts the
 * two permission rows and grants them to the default operator roles
 * (Administrator, Subscriber, Paid Subscriber) — the same set the seed targets.
 *
 * Unlike the nav backfill, it does NOT grant to every role: FOH sales is a new
 * capability, so a deliberately narrowed custom role (e.g. BOH-only kitchen
 * staff) must NOT silently gain sales access. Administrator gets it explicitly
 * here too, though the superuser bypass already covers admins.
 *
 * MUST run BEFORE the enforcing server code goes live. Idempotent: re-running
 * only inserts missing rows/links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillSalesPermissions.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { inArray, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { role, permission, rolePermission } from "../db/schema.js";

const NEW_KEYS = [
  { permissionKey: "sales:record", permissionDescription: "Stock the FOH fridge, record FOH sales, count and log FOH waste" },
  { permissionKey: "sales:read", permissionDescription: "View FOH sales history and the revenue/COGS/margin report" },
];

/** Default operator roles that receive FOH sales access (mirrors seed.ts). */
const TARGET_ROLE_NAMES = ["Administrator", "Subscriber", "Paid Subscriber"];

async function main(): Promise<void> {
  // 1. Ensure the permission rows exist (safe if seed already inserted them).
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

  // 2. Grant both keys to the default operator roles only.
  const targetRoles = await db
    .select({ roleId: role.roleId, roleName: role.roleName })
    .from(role)
    .where(inArray(role.roleName, TARGET_ROLE_NAMES));
  const newPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const newPermRows = newPerms.filter((p) => NEW_KEYS.some((k) => k.permissionKey === p.permissionKey));
  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing = computeMissingLinks(targetRoles, newPermRows, existingLinks);

  // Single transaction so a mid-run crash rolls back cleanly. The in-memory
  // check keeps sequential re-runs idempotent (role_permission has no unique
  // constraint, mirroring the seed.ts + nav-backfill pattern).
  await db.transaction(async (tx) => {
    for (const link of missing) {
      await tx.insert(rolePermission).values(link);
    }
  });

  console.log(
    `Sales backfill complete: ${targetRoles.length} default roles checked, ${missing.length} new role→permission links added.`,
  );
}

/**
 * Pure dedupe: which (role, permission) links are missing and must be inserted.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeMissingLinks(
  targetRoles: Array<{ roleId: number }>,
  newPermRows: Array<{ permissionId: number }>,
  existingLinks: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const missing: Array<{ roleId: number; permissionId: number }> = [];
  for (const r of targetRoles) {
    for (const p of newPermRows) {
      const alreadyLinked = existingLinks.some(
        (l) => l.roleId === r.roleId && l.permissionId === p.permissionId,
      );
      if (!alreadyLinked) missing.push({ roleId: r.roleId, permissionId: p.permissionId });
    }
  }
  return missing;
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("backfillSalesPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Sales backfill failed:", err);
      process.exit(1);
    });
}
