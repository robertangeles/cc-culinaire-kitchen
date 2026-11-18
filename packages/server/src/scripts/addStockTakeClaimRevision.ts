/**
 * @module scripts/addStockTakeClaimRevision
 *
 * Targeted, idempotent DDL for the mobile app's claim revision (mobile eng
 * decision D10). Adds `stock_take_category.claim_revision` — integer, NOT NULL,
 * default 0. It is bumped on every fresh claim, so a queued phone command from
 * an earlier claim can be told apart from one under the current claim.
 *
 * Additive only (ADD COLUMN IF NOT EXISTS), zero-downtime, re-runnable. Existing
 * rows backfill to 0, which matches "claimed once, no revision sent" for the web.
 * Never run whole-schema drizzle-kit push against a shared database
 * (tasks/lessons.md); this is the targeted replacement.
 *
 * Run once per environment, BEFORE the server code that reads the column deploys:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/addStockTakeClaimRevision.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

async function main(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "stock_take_category"
      ADD COLUMN IF NOT EXISTS "claim_revision" integer DEFAULT 0 NOT NULL
  `);
  console.log("Stock take claim revision ensured: stock_take_category.claim_revision (additive, idempotent).");
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addStockTakeClaimRevision.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Stock take claim revision DDL failed:", err);
      process.exit(1);
    });
}
