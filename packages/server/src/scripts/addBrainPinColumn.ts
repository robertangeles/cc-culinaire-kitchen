/**
 * @module scripts/addBrainPinColumn
 *
 * Targeted, idempotent DDL for the Brain "pin" feature (docs/specs/brain-memory.md
 * T14b). Adds:
 *   - `brain_memory.is_pinned` — boolean, NOT NULL, default false.
 *   - `idx_brain_memory_pinned (user_id) WHERE is_pinned = true` — the pinned-first
 *     listing pre-filter.
 *
 * DEVIATION FROM THE SPEC, deliberate (same as createBrainMemoryTable.ts /
 * addBrainOrgTier.ts): this database has deliberately-managed schema drift and
 * the standing rule (tasks/lessons.md #52/#54) is **never run whole-schema
 * drizzle-kit push**. This is the targeted replacement — additive only
 * (ADD COLUMN / CREATE INDEX IF NOT EXISTS), so it is zero-downtime and re-runnable.
 *
 * Run once per environment (local dev, then prod before the T14b code deploys):
 *   pnpm --filter @culinaire/server tsx src/scripts/addBrainPinColumn.ts
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
  // Pin flag. Additive, NOT NULL with a default so existing rows backfill to false.
  await db.execute(sql`
    ALTER TABLE "brain_memory"
      ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL
  `);

  // Pinned-first listing pre-filter (partial — pinned rows are a small minority).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_brain_memory_pinned"
      ON "brain_memory" ("user_id")
      WHERE is_pinned = true
  `);

  console.log(
    "Brain pin ensured: brain_memory.is_pinned + idx_brain_memory_pinned (additive, idempotent).",
  );
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addBrainPinColumn.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Brain pin DDL failed:", err);
      process.exit(1);
    });
}
