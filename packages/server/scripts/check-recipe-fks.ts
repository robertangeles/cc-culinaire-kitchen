import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

try {
  const rows = await sql`
    SELECT
      tc.table_name,
      tc.constraint_name,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.constraint_name IN (
        'recipe_version_recipe_id_fkey',
        'prep_menu_selection_recipe_id_fkey'
      );
  `;
  console.log("Current FK rules:");
  for (const r of rows) {
    console.log(`  ${r.table_name}.${r.constraint_name} → ON DELETE ${r.delete_rule}`);
  }
} finally {
  await sql.end();
}
