/**
 * @module scripts/backfillNavPermissions
 *
 * One-time rollout helper for the role-aware navigation change.
 *
 * The Menu & Costing, Waste, and Prep modules were `authenticate`-only, so
 * every logged-in user could reach them. The nav change enforces new
 * permissions (`menu:read`, `waste:read`, `prep:manage`) on those routes.
 * Without a backfill, the moment enforcement deploys EVERY existing user
 * (including runtime-edited/custom roles the seed cannot reconcile) would
 * get a 403 and a vanished sidebar item.
 *
 * This script preserves current access: it grants the three keys to EVERY
 * existing role. After this runs, no existing user loses access. Staff
 * narrowing (BOH/FOH) is then done deliberately by editing custom roles to
 * omit these keys — never by a silent global lockout.
 *
 * MUST run BEFORE the enforcing server code goes live (same window as
 * `db:deploy`). Idempotent: re-running only inserts missing links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server tsx src/scripts/backfillNavPermissions.ts
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
  { permissionKey: "menu:read", permissionDescription: "View Menu & Costing — menu engineering, food cost %, and P&L per item" },
  { permissionKey: "waste:read", permissionDescription: "View Waste analytics and log wastage" },
  { permissionKey: "prep:manage", permissionDescription: "Create and manage Prep (mise en place) sessions and tasks" },
];

async function main(): Promise<void> {
  // 1. Ensure the three permission rows exist (safe if seed already inserted them).
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

  // 2. Grant every new key to every existing role (preserve current access).
  const allRoles = await db.select({ roleId: role.roleId, roleName: role.roleName }).from(role);
  const newPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const newPermRows = newPerms.filter((p) => NEW_KEYS.some((k) => k.permissionKey === p.permissionKey));
  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing = computeMissingLinks(allRoles, newPermRows, existingLinks);

  // Wrap the grant loop in a single transaction so a mid-run crash rolls back
  // cleanly — no half-applied permission state on a production rollout. The
  // in-memory `existingLinks` check keeps sequential re-runs idempotent
  // (role_permission has no unique constraint, mirroring the seed.ts pattern).
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
 * Extracted so idempotency is unit-testable without a DB — given an
 * `existingLinks` set that already covers a pair, that pair is never returned,
 * so a re-run computes an empty set.
 */
export function computeMissingLinks(
  allRoles: Array<{ roleId: number }>,
  newPermRows: Array<{ permissionId: number }>,
  existingLinks: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const missing: Array<{ roleId: number; permissionId: number }> = [];
  for (const r of allRoles) {
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
if (process.argv[1]?.endsWith("backfillNavPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
