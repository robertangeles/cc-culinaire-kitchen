/**
 * @module scripts/addBrainNudgeOptIn
 *
 * Targeted, idempotent DDL for the Brain nudges opt-in (Phase 3 T17). Adds:
 *   - `user.brain_nudges_opt_in` — boolean, NOT NULL, default false.
 *
 * DEVIATION FROM THE SPEC, deliberate (same as the other Brain DDL scripts):
 * this DB has managed drift and the standing rule (tasks/lessons.md #52/#54/#56)
 * is **never run whole-schema drizzle-kit push**. This is the targeted, additive,
 * re-runnable replacement — ADD COLUMN IF NOT EXISTS with a default so existing
 * rows backfill to false. Zero-downtime.
 *
 * Run once per environment (local dev, then prod before the code deploys):
 *   pnpm --filter @culinaire/server exec tsx src/scripts/addBrainNudgeOptIn.ts
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
    ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "brain_nudges_opt_in" boolean DEFAULT false NOT NULL
  `);
  console.log("Brain nudge opt-in ensured: user.brain_nudges_opt_in (additive, idempotent).");
}

if (process.argv[1]?.endsWith("addBrainNudgeOptIn.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Brain nudge opt-in DDL failed:", err);
      process.exit(1);
    });
}
