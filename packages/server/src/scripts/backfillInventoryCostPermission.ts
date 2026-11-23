/**
 * @module scripts/backfillInventoryCostPermission
 *
 * Rollout helper for Wave 3. Stock value, unit costs and the expected quantity on a count used to reach every
 * holder of `inventory:count`. The server now sends them only to holders of `inventory:cost`, so a counter can
 * count blind. Every role that holds any inventory key today (`inventory:count`, `inventory:manage`,
 * `inventory:hq`) is given `inventory:cost`, so nobody loses what they see now; an owner who wants blind
 * counting removes it from that role in Settings → Roles. A role with no inventory key does not gain it.
 *
 * MUST run BEFORE the server code that hides these fields goes live. Idempotent: re-running only inserts missing
 * rows/links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillInventoryCostPermission.ts
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

export const COST_KEY = "inventory:cost";
export const INVENTORY_KEYS = ["inventory:count", "inventory:manage", "inventory:hq"];

/**
 * Pure: the (role, permission) links to insert so every role holding an inventory key also holds `inventory:cost`.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeCostGrants(
  perms: Array<{ permissionId: number; permissionKey: string }>,
  links: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const costId = perms.find((p) => p.permissionKey === COST_KEY)?.permissionId;
  if (costId === undefined) return [];
  const inventoryIds = new Set(perms.filter((p) => INVENTORY_KEYS.includes(p.permissionKey)).map((p) => p.permissionId));
  const hasCost = new Set(links.filter((l) => l.permissionId === costId).map((l) => l.roleId));
  const roles = new Set(links.filter((l) => inventoryIds.has(l.permissionId)).map((l) => l.roleId));
  return [...roles].filter((roleId) => !hasCost.has(roleId)).map((roleId) => ({ roleId, permissionId: costId }));
}

async function main(): Promise<void> {
  const existing = await db.select({ id: permission.permissionId }).from(permission).where(eq(permission.permissionKey, COST_KEY));
  if (existing.length === 0) {
    await db.insert(permission).values({
      permissionKey: COST_KEY,
      permissionDescription: "See stock value, unit costs and expected quantities (without it a counter counts blind)",
    });
    console.log(`Inserted permission: ${COST_KEY}`);
  }

  const perms = await db.select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey }).from(permission);
  const links = await db.select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId }).from(rolePermission);
  const missing = computeCostGrants(perms, links);

  // role_permission has no unique constraint, so the in-memory dedupe above is what keeps re-runs idempotent.
  await db.transaction(async (tx) => {
    for (const link of missing) await tx.insert(rolePermission).values(link);
  });

  console.log(`inventory:cost backfill complete: ${missing.length} new role→permission links added.`);
}

if (process.argv[1]?.endsWith("backfillInventoryCostPermission.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("inventory:cost backfill failed:", err);
      process.exit(1);
    });
}
