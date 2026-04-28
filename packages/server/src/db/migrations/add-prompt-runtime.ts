/**
 * Migration: add prompt.runtime column for on-device prompt support
 *
 * Adds a `runtime` discriminator to the `prompt` table. Existing prompts
 * default to 'server' (invoked via OpenRouter). Antoine — the system prompt
 * for the mobile companion app's on-device Gemma 3n E4B model — flips to
 * 'device' so server-side resolution paths can refuse to invoke it and the
 * admin UI can hide the misleading model dropdown.
 *
 * Idempotent. Safe to re-run. Per lessons.md #45, this uses raw SQL with
 * IF NOT EXISTS + a constraint-existence check rather than drizzle-kit push,
 * which is hostile to Neon.
 *
 * Usage:
 * ```sh
 * cd packages/server
 * npx tsx src/db/migrations/add-prompt-runtime.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting prompt.runtime migration...\n");

  // 1. Add the column with a default. NOT NULL is safe because of the default.
  await db.execute(sql`
    ALTER TABLE prompt
    ADD COLUMN IF NOT EXISTS runtime varchar(20) NOT NULL DEFAULT 'server'
  `);
  console.log("  ✓ prompt.runtime column added (default 'server')");

  // 2. Add the CHECK constraint, idempotently. Postgres has no native
  //    'ADD CONSTRAINT IF NOT EXISTS' for CHECK; use a guarded DO block.
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'prompt_runtime_check'
      ) THEN
        ALTER TABLE prompt
        ADD CONSTRAINT prompt_runtime_check
        CHECK (runtime IN ('server', 'device'));
      END IF;
    END
    $$
  `);
  console.log("  ✓ prompt_runtime_check constraint ensured");

  // 3. Flip Antoine to device runtime. The WHERE includes `runtime <> 'device'`
  //    so re-running the migration is a no-op (UPDATE affects 0 rows).
  const result = await db.execute(sql`
    UPDATE prompt
    SET runtime = 'device',
        updated_dttm = now()
    WHERE prompt_key = 'antoine-system-prompt'
      AND runtime <> 'device'
  `);
  // drizzle's NeonDatabase.execute returns a result with rowCount on most drivers
  const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (rowCount > 0) {
    console.log(`  ✓ antoine-system-prompt flipped to runtime='device' (${rowCount} row)`);
  } else {
    console.log("  ✓ antoine-system-prompt already at runtime='device' (or not present yet) — no-op");
  }

  // 4. Verification readout — surfaces any prompt that's mis-flagged so the
  //    operator can sanity-check before declaring the migration done.
  const summary = await db.execute(sql`
    SELECT runtime, count(*)::int AS n
    FROM prompt
    GROUP BY runtime
    ORDER BY runtime
  `);
  console.log("\n  Current prompt runtime distribution:");
  for (const row of summary as unknown as Array<{ runtime: string; n: number }>) {
    console.log(`    ${row.runtime}: ${row.n}`);
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
