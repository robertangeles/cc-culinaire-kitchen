/**
 * @module scripts/cleanupE2eData
 *
 * Hard-deletes rows the Playwright suite left behind. The API can only cancel
 * purchase orders and shifts, so those rows (and the role / supplier they pin)
 * accumulate in the dev DB. Only rows whose name starts with the E2E prefix
 * (`e2e-`) and are older than the cutoff are touched, so a run in progress is
 * never affected.
 *
 * Refuses to run as a production process. (db/index.ts separately refuses a
 * non-prod process pointed at the prod host.)
 *
 * Run:
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/cleanupE2eData.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix, isProductionProcess } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

const E2E_PREFIX_LIKE = "e2e-%";
const DEFAULT_MAX_AGE_MINUTES = 60;

export function assertCleanupAllowed(prod: boolean): void {
  if (prod) throw new Error("Refusing to delete E2E data in a production process.");
}

export function cutoffFrom(now: Date, maxAgeMinutes: number): Date {
  return new Date(now.getTime() - maxAgeMinutes * 60_000);
}

export interface CleanupCounts {
  receivingLines: number;
  receivingSessions: number;
  purchaseOrderLines: number;
  purchaseOrders: number;
  shifts: number;
  rosterRoles: number;
  publicHolidays: number;
}

export async function cleanupE2eData(maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES): Promise<CleanupCounts> {
  assertCleanupAllowed(isProductionProcess());
  const cutoff = cutoffFrom(new Date(), maxAgeMinutes).toISOString();

  return db.transaction(async (tx) => {
    const count = async (q: ReturnType<typeof sql>): Promise<number> => (await tx.execute(q)).count;

    const oldPos = sql`SELECT po.po_id FROM purchase_order po
      JOIN supplier s ON s.supplier_id = po.supplier_id
      WHERE s.supplier_name LIKE ${E2E_PREFIX_LIKE} AND po.created_dttm < ${cutoff}::timestamptz`;
    const oldRoles = sql`SELECT roster_role_id FROM roster_role
      WHERE role_name LIKE ${E2E_PREFIX_LIKE} AND created_dttm < ${cutoff}::timestamptz`;

    const receivingLines = await count(sql`DELETE FROM receiving_line WHERE session_id IN
      (SELECT session_id FROM receiving_session WHERE po_id IN (${oldPos}))`);
    const receivingSessions = await count(sql`DELETE FROM receiving_session WHERE po_id IN (${oldPos})`);
    const purchaseOrderLines = await count(sql`DELETE FROM purchase_order_line WHERE po_id IN (${oldPos})`);
    const purchaseOrders = await count(sql`DELETE FROM purchase_order WHERE po_id IN (${oldPos})`);
    // shift_assignment rows cascade from shift.
    const shifts = await count(sql`DELETE FROM shift WHERE roster_role_id IN (${oldRoles})`);
    const rosterRoles = await count(sql`DELETE FROM roster_role WHERE roster_role_id IN (${oldRoles})
      AND NOT EXISTS (SELECT 1 FROM roster_shift_template t WHERE t.roster_role_id = roster_role.roster_role_id)`);
    const publicHolidays = await count(
      sql`DELETE FROM public_holiday WHERE holiday_name LIKE ${E2E_PREFIX_LIKE} AND created_dttm < ${cutoff}::timestamptz`,
    );

    return {
      receivingLines,
      receivingSessions,
      purchaseOrderLines,
      purchaseOrders,
      shifts,
      rosterRoles,
      publicHolidays,
    };
  });
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("cleanupE2eData.ts")) {
  cleanupE2eData()
    .then((counts) => {
      console.log("E2E cleanup deleted:", counts);
      process.exit(0);
    })
    .catch((err) => {
      console.error("E2E cleanup failed:", err);
      process.exit(1);
    });
}
