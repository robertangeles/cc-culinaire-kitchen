/**
 * @module scripts/addStockTakeCountMode
 *
 * Targeted, idempotent DDL for counting a stock take by storage area (mobile
 * release 1, X1). Adds `stock_take_session.count_mode` — varchar(10), NOT NULL,
 * default 'CATEGORY'. 'AREA' means the session's category rows are storage area
 * names (plus the reserved "Unassigned" bucket).
 *
 * Additive only (ADD COLUMN IF NOT EXISTS), zero-downtime, re-runnable. Existing
 * sessions backfill to 'CATEGORY', which is what they are. Never run whole-schema
 * drizzle-kit push against a shared database (tasks/lessons.md).
 *
 * Run once per environment, BEFORE the server code that reads the column deploys:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/addStockTakeCountMode.ts
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
    ALTER TABLE "stock_take_session"
      ADD COLUMN IF NOT EXISTS "count_mode" varchar(10) DEFAULT 'CATEGORY' NOT NULL
  `);
  console.log("Stock take count mode ensured: stock_take_session.count_mode (additive, idempotent).");
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addStockTakeCountMode.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Stock take count mode DDL failed:", err);
      process.exit(1);
    });
}
