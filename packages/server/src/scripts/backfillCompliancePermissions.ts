/**
 * @module scripts/backfillCompliancePermissions
 *
 * One-time rollout helper for the Compliance Vault permissions.
 *
 * `seed.ts` only inserts rows that don't already exist — a fresh install picks
 * up the new `compliance:*` permissions and role links automatically, but an
 * existing install's roles were seeded (and possibly hand-edited) long before
 * `db:seed` last ran, so nothing re-applies the new mappings to them until
 * someone reruns the seed or this script. Without this backfill, the moment
 * the enforcing routes deploy, every existing Subscriber / Paid Subscriber
 * user 403s on the Compliance Vault they were never explicitly denied.
 *
 * This script re-applies the seed's role→permission split for the compliance
 * keys, matched by role name, to every existing role — same technique the
 * seed's own `rolePermMappings` loop uses (find the role by name, insert
 * whatever links are missing) but isolated into its own idempotent script so
 * it can run standalone against production ahead of a deploy, without
 * re-running all of seed.ts's other side effects (prompts, guides, settings):
 *   - Administrator: all four (superuser bypass exists, but the row is
 *     listed explicitly, matching every other key already in the seed)
 *   - Subscriber: compliance:read-own only
 *   - Paid Subscriber: compliance:read-own, compliance:read-all,
 *     compliance:verify (never manage-rules — that one stays admin-only
 *     until an org explicitly grants it)
 * A role whose name doesn't match one of the three above is skipped, same as
 * the seed's mapping loop.
 *
 * MUST run BEFORE the enforcing server code goes live (same window as
 * `db:deploy`). Idempotent: re-running only inserts missing links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillCompliancePermissions.ts
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
  { permissionKey: "compliance:read-own", permissionDescription: "View and upload your own compliance documents" },
  { permissionKey: "compliance:read-all", permissionDescription: "View compliance documents for all staff at your venue" },
  { permissionKey: "compliance:verify", permissionDescription: "Approve or reject uploaded compliance documents" },
  { permissionKey: "compliance:manage-rules", permissionDescription: "Manage expiry rules and organisation document requirements" },
];

/** Compliance keys granted to a role, keyed by role name — mirrors seed.ts's rolePermMappings. */
const KEYS_BY_ROLE_NAME: Record<string, string[]> = {
  Administrator: ["compliance:read-own", "compliance:read-all", "compliance:verify", "compliance:manage-rules"],
  Subscriber: ["compliance:read-own"],
  "Paid Subscriber": ["compliance:read-own", "compliance:read-all", "compliance:verify"],
};

async function main(): Promise<void> {
  // 1. Ensure the four permission rows exist (safe if seed already inserted them).
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

  // 2. Grant each role its compliance keys per KEYS_BY_ROLE_NAME. Roles whose
  // name doesn't match Administrator/Subscriber/Paid Subscriber are skipped —
  // same as the seed's own rolePermMappings loop.
  const allRoles = await db.select({ roleId: role.roleId, roleName: role.roleName }).from(role);
  const allPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing = computeMissingLinks(allRoles, allPerms, existingLinks);

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
if (process.argv[1]?.endsWith("backfillCompliancePermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
