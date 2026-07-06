/**
 * @module scripts/createBrainMemoryTable
 *
 * Targeted, idempotent DDL for the Brain's `brain_memory` table
 * (docs/specs/brain-memory.md T1).
 *
 * DEVIATION FROM THE SPEC, deliberate: the spec's deployment step says
 * `drizzle-kit push`, but this database has known, deliberately-managed
 * schema drift and the standing rule (tasks/lessons.md #52/#54) is
 * **never run whole-schema drizzle-kit push against it** — targeted
 * scripts only. This script IS the targeted script: it creates exactly
 * the objects `schema.ts`'s `brainMemory` defines, with drizzle-kit
 * naming conventions so the schema file and live DB agree. Additive
 * only (CREATE IF NOT EXISTS) → zero-downtime, re-runnable.
 *
 * Run once per environment (local dev is already applied; prod before
 * the Brain code deploys):
 *   pnpm --filter @culinaire/server tsx src/scripts/createBrainMemoryTable.ts
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
    CREATE TABLE IF NOT EXISTS "brain_memory" (
      "memory_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" integer NOT NULL,
      "organisation_id" integer,
      "scope" varchar(10) DEFAULT 'user' NOT NULL,
      "memory_kind" varchar(20) DEFAULT 'event' NOT NULL,
      "source_type" varchar(30) NOT NULL,
      "source_ref" varchar(100),
      "title" varchar(200),
      "body" text NOT NULL,
      "embedding" vector(1536),
      "status" varchar(20) DEFAULT 'pending' NOT NULL,
      "attempt_count" integer DEFAULT 0 NOT NULL,
      "next_attempt_dttm" timestamp with time zone,
      "created_dttm" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_dttm" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  // FKs added conditionally so re-runs are clean (ADD CONSTRAINT has no IF NOT EXISTS).
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_memory_user_id_user_user_id_fk') THEN
        ALTER TABLE "brain_memory"
          ADD CONSTRAINT "brain_memory_user_id_user_user_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."user"("user_id");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brain_memory_organisation_id_organisation_organisation_id_fk') THEN
        ALTER TABLE "brain_memory"
          ADD CONSTRAINT "brain_memory_organisation_id_organisation_organisation_id_fk"
          FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("organisation_id");
      END IF;
    END $$
  `);

  // Upsert target for recordMemory (owner-scoped; NULL source_ref never collides).
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_brain_memory_source_unique"
      ON "brain_memory" ("user_id", "source_type", "source_ref")
  `);
  // User-private recall pre-filter + "Your Brain" listing.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_brain_memory_user_scope"
      ON "brain_memory" ("user_id", "scope")
  `);
  // Worker claim scan + admin queue-depth / re-embed-failed queries (partial).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_brain_memory_status"
      ON "brain_memory" ("status")
      WHERE status IN ('pending', 'failed')
  `);

  console.log("brain_memory table + indexes ensured (additive, idempotent). NO ANN index by design (spec E3).");
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("createBrainMemoryTable.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("brain_memory DDL failed:", err);
      process.exit(1);
    });
}
