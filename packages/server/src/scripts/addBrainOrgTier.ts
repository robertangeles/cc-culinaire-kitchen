/**
 * @module scripts/addBrainOrgTier
 *
 * Targeted, idempotent DDL for the Brain org tier (docs/specs/brain-memory.md
 * T11, Phase 2). Adds:
 *   - `user.selected_organisation_id` — the active-org selection column
 *     (spec E-fold #8), nullable, FK → organisation.
 *   - `idx_brain_memory_org_scope (organisation_id, scope)` — the pre-filter
 *     for the org-shared branch of the recall query.
 *
 * DEVIATION FROM THE SPEC, deliberate (same as createBrainMemoryTable.ts):
 * this database has deliberately-managed schema drift and the standing rule
 * (tasks/lessons.md #52/#54) is **never run whole-schema drizzle-kit push**.
 * This is the targeted replacement — additive only (ADD COLUMN / CREATE INDEX
 * IF NOT EXISTS, constraint guarded by pg_constraint), so it is zero-downtime
 * and re-runnable.
 *
 * Run once per environment (local dev, then prod before the T11 code deploys):
 *   pnpm --filter @culinaire/server exec tsx src/scripts/addBrainOrgTier.ts
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
  // Active-org selection column on `user` (spec E-fold #8). Additive, nullable.
  await db.execute(sql`
    ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "selected_organisation_id" integer
  `);

  // FK added conditionally so re-runs are clean (ADD CONSTRAINT has no IF NOT EXISTS).
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_selected_organisation_id_organisation_organisation_id_fk'
      ) THEN
        ALTER TABLE "user"
          ADD CONSTRAINT "user_selected_organisation_id_organisation_organisation_id_fk"
          FOREIGN KEY ("selected_organisation_id")
          REFERENCES "public"."organisation"("organisation_id");
      END IF;
    END $$
  `);

  // Org-shared recall pre-filter (spec T11): the org branch of the recall
  // WHERE narrows to one active org's scope='org' slice.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_brain_memory_org_scope"
      ON "brain_memory" ("organisation_id", "scope")
  `);

  console.log(
    "Brain org tier ensured: user.selected_organisation_id (+FK) and idx_brain_memory_org_scope (additive, idempotent).",
  );
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addBrainOrgTier.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Brain org tier DDL failed:", err);
      process.exit(1);
    });
}
