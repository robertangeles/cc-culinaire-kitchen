/**
 * One-shot verification: does ckm_feedback exist in the live DB after
 * the push? Logs schema state and exits. Read-only — no writes.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

try {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ckm_feedback';
  `;
  console.log("ckm_feedback exists:", tables.length > 0);

  if (tables.length > 0) {
    const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ckm_feedback'
      ORDER BY ordinal_position;
    `;
    console.log("\nColumns:");
    for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type} (nullable=${c.is_nullable})`);

    const idx = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ckm_feedback';
    `;
    console.log("\nIndexes:");
    for (const i of idx) console.log(`  ${i.indexname}`);

    const checks = await sql<{ conname: string; consrc: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS consrc
      FROM pg_constraint
      WHERE conrelid = 'public.ckm_feedback'::regclass AND contype = 'c';
    `;
    console.log("\nCHECK constraints:");
    for (const c of checks) console.log(`  ${c.conname}: ${c.consrc}`);
  }

  // Also check if the guide_guide_key_unique constraint was added
  const guide = await sql<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.guide'::regclass
      AND conname = 'guide_guide_key_unique';
  `;
  console.log("\nguide_guide_key_unique on guide table:", guide.length > 0 ? "PRESENT (drift was applied)" : "NOT present (drift NOT applied — good)");
} finally {
  await sql.end();
}
