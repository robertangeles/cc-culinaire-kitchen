/**
 * Targeted, idempotent fix for recipe FK cascade rules.
 *
 * Why this script (rather than `drizzle-kit push`): push surfaces unrelated
 * drift (knowledge_document.file_path drop, 5 pending unique constraints)
 * and trips over the pg_stat_statements_info view. Those need separate,
 * deliberate fixes. This script applies ONLY the three FK rule changes
 * needed for `purgeArchivedRecipes` to succeed.
 *
 * Usage: `npx tsx scripts/fix-recipe-fk-cascade.ts`
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

// Note: prep_task.recipe_id has no FK constraint in the live DB (schema
// drift — code declares it but the constraint was never created). Out of
// scope for this purge fix; address separately.
const stmts: string[] = [
  `ALTER TABLE "recipe_version"
     DROP CONSTRAINT IF EXISTS "recipe_version_recipe_id_fkey",
     ADD CONSTRAINT "recipe_version_recipe_id_fkey"
       FOREIGN KEY ("recipe_id") REFERENCES "recipe"("recipe_id") ON DELETE CASCADE;`,
  `ALTER TABLE "prep_menu_selection"
     DROP CONSTRAINT IF EXISTS "prep_menu_selection_recipe_id_fkey",
     ADD CONSTRAINT "prep_menu_selection_recipe_id_fkey"
       FOREIGN KEY ("recipe_id") REFERENCES "recipe"("recipe_id") ON DELETE SET NULL;`,
];

try {
  await sql.begin(async (tx) => {
    for (const s of stmts) {
      const head = s.replace(/\s+/g, " ").slice(0, 80);
      console.log("→", head, "…");
      await tx.unsafe(s);
    }
  });
  console.log("\n✓ Recipe FK cascade rules applied.");
} catch (err) {
  console.error("Apply failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
