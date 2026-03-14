/**
 * @module db/migrations/add-prompt-key
 *
 * Migration script that backfills the `prompt_key` column for existing
 * prompt rows. The key is a machine-readable slug derived from the prompt
 * name (e.g. "systemPrompt" → "system-prompt").
 *
 * This migration is idempotent — rows that already have a `prompt_key`
 * value are skipped.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/migrations/add-prompt-key.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log("Backfilling prompt_key for existing prompts...");

  await sql.begin(async (tx) => {
    // Backfill systemPrompt rows with key "system-prompt"
    const updated = await tx`
      UPDATE prompt
      SET prompt_key = 'system-prompt'
      WHERE prompt_name = 'systemPrompt'
        AND (prompt_key IS NULL OR prompt_key = '')
    `;
    console.log(`Updated ${updated.count} systemPrompt rows with key "system-prompt"`);
  });

  console.log("Migration complete!");
  await sql.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
