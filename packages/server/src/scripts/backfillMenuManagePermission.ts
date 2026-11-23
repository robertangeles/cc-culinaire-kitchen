/**
 * @module scripts/backfillMenuManagePermission
 *
 * Rollout helper for the Wave 7 menu split. `menu:read` used to gate every Menu & Costing route, edits, deletes,
 * voids and paid model calls included. The server now requires `menu:manage` for those, and keeps `menu:read` for
 * reading and for recording a sale. Every role that holds `menu:read` is given `menu:manage`, so no role loses
 * access it has today. A role that never held `menu:read` does not gain it.
 *
 * MUST run BEFORE the enforcing server code goes live. Idempotent: re-running only inserts missing rows/links.
 *
 * Run once:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillMenuManagePermission.ts
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

export const SPLIT = { from: "menu:read", to: "menu:manage" };

const NEW_KEY = {
  permissionKey: "menu:manage",
  permissionDescription: "Edit Menu & Costing — create, change and delete menu items, set category targets, void sales, run AI recommendations",
};

/**
 * Pure: the (role, permission) links to insert so every role holding `menu:read` also holds `menu:manage`.
 * Extracted so idempotency is unit-testable without a DB.
 */
export function computeSplitGrants(
  perms: Array<{ permissionId: number; permissionKey: string }>,
  links: Array<{ roleId: number; permissionId: number }>,
): Array<{ roleId: number; permissionId: number }> {
  const idOf = (key: string) => perms.find((p) => p.permissionKey === key)?.permissionId;
  const fromId = idOf(SPLIT.from);
  const toId = idOf(SPLIT.to);
  if (fromId === undefined || toId === undefined) return [];
  const have = new Set(links.map((l) => `${l.roleId}:${l.permissionId}`));
  return [...new Set(links.filter((l) => l.permissionId === fromId).map((l) => l.roleId))]
    .filter((roleId) => !have.has(`${roleId}:${toId}`))
    .map((roleId) => ({ roleId, permissionId: toId }));
}

async function main(): Promise<void> {
  const existing = await db.select({ id: permission.permissionId }).from(permission).where(eq(permission.permissionKey, NEW_KEY.permissionKey));
  if (existing.length === 0) {
    await db.insert(permission).values(NEW_KEY);
    console.log(`Inserted permission: ${NEW_KEY.permissionKey}`);
  }

  const perms = await db.select({ permissionId: permission.permissionId, permissionKey: permission.permissionKey }).from(permission);
  const links = await db.select({ roleId: rolePermission.roleId, permissionId: rolePermission.permissionId }).from(rolePermission);
  const missing = computeSplitGrants(perms, links);

  // role_permission has no unique constraint, so the in-memory dedupe above is what keeps re-runs idempotent.
  await db.transaction(async (tx) => {
    for (const link of missing) await tx.insert(rolePermission).values(link);
  });

  console.log(`Menu split backfill complete: ${missing.length} new role→permission links added.`);
}

if (process.argv[1]?.endsWith("backfillMenuManagePermission.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Menu split backfill failed:", err);
      process.exit(1);
    });
}
