/**
 * @module scripts/backfillWastePrepPermissions
 *
 * Rollout helper for the Wave 2 permission splits. `waste:read` used to gate every waste route and
 * `prep:manage` every prep route. The server now also accepts two narrower keys:
 *   waste:log  - log, edit and delete your own waste entries (a logger need not see waste cost reports)
 *   prep:read  - read prep sessions, tick tasks (a cook need not create or end sessions)
 * Every role that holds the old key is given the new one, so no role loses access it has today. A role
 * that never held the old key does not gain the new one.
 *
 * MUST run BEFORE the enforcing server code goes live. Idempotent: re-running only inserts missing rows/links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillWastePrepPermissions.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { permission, rolePermission } from "../db/schema.js";

export const SPLITS = [
  { from: "waste:read", to: "waste:log" },
  { from: "prep:manage", to: "prep:read" },
];

const NEW_KEYS = [
  { permissionKey: "waste:log", permissionDescription: "Log, edit and delete your own waste entries" },
  { permissionKey: "prep:read", permissionDescription: "View Prep sessions and tick prep tasks at your location" },
];

/**
 * Pure: the (role, permission) links to insert so every role holding a split's `from` key also holds its `to` key.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeSplitGrants(
  perms: Array<{ permissionId: number; permissionKey: string }>,
  links: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const idOf = (key: string) => perms.find((p) => p.permissionKey === key)?.permissionId;
  const have = new Set(links.map((l) => `${l.roleId}:${l.permissionId}`));
  const missing: Array<{ roleId: number; permissionId: number }> = [];
  for (const { from, to } of SPLITS) {
    const fromId = idOf(from);
    const toId = idOf(to);
    if (fromId === undefined || toId === undefined) continue;
    for (const roleId of new Set(links.filter((l) => l.permissionId === fromId).map((l) => l.roleId))) {
      if (!have.has(`${roleId}:${toId}`)) missing.push({ roleId, permissionId: toId });
    }
  }
  return missing;
}

async function main(): Promise<void> {
  for (const p of NEW_KEYS) {
    const existing = await db.select({ id: permission.permissionId }).from(permission).where(eq(permission.permissionKey, p.permissionKey));
    if (existing.length === 0) {
      await db.insert(permission).values(p);
      console.log(`Inserted permission: ${p.permissionKey}`);
    }
  }

  const perms = await db.select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey }).from(permission);
  const links = await db.select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId }).from(rolePermission);
  const missing = computeSplitGrants(perms, links);

  // role_permission has no unique constraint, so the in-memory dedupe above is what keeps re-runs idempotent.
  await db.transaction(async (tx) => {
    for (const link of missing) await tx.insert(rolePermission).values(link);
  });

  console.log(`Waste/prep split backfill complete: ${missing.length} new role→permission links added.`);
}

if (process.argv[1]?.endsWith("backfillWastePrepPermissions.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Waste/prep split backfill failed:", err);
      process.exit(1);
    });
}
