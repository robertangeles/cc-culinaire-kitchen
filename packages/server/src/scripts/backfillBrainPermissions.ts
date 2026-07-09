/**
 * @module scripts/backfillBrainPermissions
 *
 * One-time rollout helper for The Brain (docs/specs/brain-memory.md, T2).
 *
 * The "Your Brain" routes enforce two new permissions (`brain:read`,
 * `brain:manage`). The seed grants them to the three default roles, but a
 * production DB also holds runtime-edited/custom roles the seed cannot
 * reconcile. Those users' chat turns are captured the moment
 * `brain_capture_enabled` flips on — and a user whose memories are captured
 * MUST be able to view and delete them (consent baseline, spec D8). So this
 * script grants both keys to EVERY existing role. Narrowing (if ever wanted)
 * is then done deliberately by editing roles — never by a silent lockout
 * from a consent surface.
 *
 * MUST run BEFORE the enforcing server code deploys (same window as
 * `db:deploy`), per the spec's rollout order. Idempotent: re-running only
 * inserts missing links. The grant loop runs in a single transaction so a
 * mid-run crash rolls back cleanly.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillBrainPermissions.ts
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
import { computeMissingLinks } from "./backfillNavPermissions.js";

const NEW_KEYS = [
  { permissionKey: "brain:read", permissionDescription: "View Your Brain — the memories CulinAIre has captured for you" },
  { permissionKey: "brain:manage", permissionDescription: "Delete and correct Brain memories (own memories; org admins also manage org-shared memories)" },
];

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

  // 2. Grant both keys to every existing role (consent baseline — see module doc).
  const allRoles = await db.select({ roleId: role.roleId, roleName: role.roleName }).from(role);
  const newPerms = await db
    .select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey })
    .from(permission);
  const newPermRows = newPerms.filter((p) => NEW_KEYS.some((k) => k.permissionKey === p.permissionKey));
  const existingLinks = await db
    .select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId })
    .from(rolePermission);

  const missing = computeMissingLinks(allRoles, newPermRows, existingLinks);

  // Single transaction: a mid-run crash rolls back cleanly — no half-applied
  // permission state on a production rollout (spec eng-fold: transactional backfill).
  await db.transaction(async (tx) => {
    for (const link of missing) {
      await tx.insert(rolePermission).values(link);
    }
  });

  console.log(
    `Brain backfill complete: ${allRoles.length} roles checked, ${missing.length} new role→permission links added.`,
  );
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("backfillBrainPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Brain backfill failed:", err);
      process.exit(1);
    });
}
