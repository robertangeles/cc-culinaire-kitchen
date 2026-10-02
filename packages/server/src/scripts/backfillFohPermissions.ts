/**
 * One-time: grant sales:record and sales:read to Subscriber and Paid Subscriber.
 *
 * The FOH tab is new functionality — custom roles get opt-in access via the
 * Roles editor; only the two built-in subscriber roles get it automatically.
 * Administrator is superuser and bypasses all requirePermission checks, so it
 * is excluded here.
 *
 * Idempotent: safe to re-run.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/backfillFohPermissions.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/backfillFohPermissions.ts
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

const TARGET_ROLES = ["Subscriber", "Paid Subscriber"];

const NEW_KEYS = [
  { permissionKey: "sales:record", permissionDescription: "Record front-of-house sales, restock FOH shelf, count and log waste" },
  { permissionKey: "sales:read", permissionDescription: "View FOH sales history and revenue reports" },
];

async function main(): Promise<void> {
  // 1. Ensure permission rows exist (seed may already have inserted them).
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

  // 2. Grant to Subscriber and Paid Subscriber only.
  const targetRoles = await db
    .select({ roleId: role.roleId, roleName: role.roleName })
    .from(role);
  const filteredRoles = targetRoles.filter((r) => TARGET_ROLES.includes(r.roleName));

  const newPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const newPermRows = newPerms.filter((p) => NEW_KEYS.some((k) => k.permissionKey === p.permissionKey));

  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing: Array<{ roleId: number; permissionId: number }> = [];
  for (const r of filteredRoles) {
    for (const p of newPermRows) {
      const alreadyLinked = existingLinks.some(
        (l) => l.roleId === r.roleId && l.permissionId === p.permissionId,
      );
      if (!alreadyLinked) missing.push({ roleId: r.roleId, permissionId: p.permissionId });
    }
  }

  await db.transaction(async (tx) => {
    for (const link of missing) {
      await tx.insert(rolePermission).values(link);
    }
  });

  console.log(
    `Backfill complete: ${filteredRoles.length} roles checked, ${missing.length} new role→permission links added.`,
  );
}

if (process.argv[1]?.endsWith("backfillFohPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
