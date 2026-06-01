/**
 * Targeted, idempotent migration for the forecast-driven prep planner.
 *
 * Why this script (not `drizzle-kit push`): per tasks/lessons.md #50, push diffs
 * the WHOLE schema against a drifted Neon DB and trips on pg_stat_statements /
 * pending constraints. This applies ONLY the additive changes the prep planner
 * needs, idempotently (IF [NOT] EXISTS), inside a single transaction.
 *
 * Adds:
 *   - prep_component                          (new table)
 *   - prep_component_ingredient               (new table, one-level)
 *   - menu_item_ingredient.prep_component_id  (nullable FK, ON DELETE SET NULL)
 *   - prep_task.ingredient_id / prep_component_id / use_by / is_over_prep_ind
 *   - ingredient_cross_usage.ingredient_id    (nullable FK)
 *   - FK indexes for all of the above
 *
 * Usage:   npx tsx scripts/migrate-prep-components.ts
 * Verify:  npx tsx scripts/check-prep-components.ts   (run BEFORE and AFTER)
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const stmts: string[] = [
  // 1. prep_component ---------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS "prep_component" (
     "prep_component_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organisation_id" integer NOT NULL REFERENCES "organisation"("organisation_id"),
     "name" varchar(200) NOT NULL,
     "base_unit" varchar(20) NOT NULL,
     "yield_pct" numeric(5,2) NOT NULL DEFAULT 100,
     "shelf_life_days" integer,
     "is_tcs_ind" boolean NOT NULL DEFAULT false,
     "created_dttm" timestamptz NOT NULL DEFAULT now(),
     "updated_dttm" timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "idx_prep_component_org_name" ON "prep_component" ("organisation_id","name");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_component_org" ON "prep_component" ("organisation_id");`,

  // 2. prep_component_ingredient (one level — no child_component_id) ----------
  `CREATE TABLE IF NOT EXISTS "prep_component_ingredient" (
     "id" serial PRIMARY KEY,
     "prep_component_id" uuid NOT NULL REFERENCES "prep_component"("prep_component_id") ON DELETE CASCADE,
     "ingredient_id" uuid REFERENCES "ingredient"("ingredient_id") ON DELETE SET NULL,
     "ingredient_name" varchar(200) NOT NULL,
     "quantity" numeric(10,3) NOT NULL,
     "unit" varchar(20) NOT NULL,
     "yield_pct" numeric(5,2) NOT NULL DEFAULT 100,
     "created_dttm" timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_component_ingredient_component" ON "prep_component_ingredient" ("prep_component_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_component_ingredient_ingredient" ON "prep_component_ingredient" ("ingredient_id");`,

  // 3. menu_item_ingredient.prep_component_id ---------------------------------
  `ALTER TABLE "menu_item_ingredient"
     ADD COLUMN IF NOT EXISTS "prep_component_id" uuid
     REFERENCES "prep_component"("prep_component_id") ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS "idx_menu_item_ingredient_prep_component" ON "menu_item_ingredient" ("prep_component_id");`,

  // 4. prep_task new columns --------------------------------------------------
  `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "ingredient_id" uuid REFERENCES "ingredient"("ingredient_id");`,
  `ALTER TABLE "prep_task"
     ADD COLUMN IF NOT EXISTS "prep_component_id" uuid
     REFERENCES "prep_component"("prep_component_id") ON DELETE SET NULL;`,
  `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "on_hand_qty" numeric(10,3);`,
  `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "prep_needed" numeric(10,3);`,
  `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "use_by" date;`,
  `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "is_over_prep_ind" boolean NOT NULL DEFAULT false;`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_task_session" ON "prep_task" ("prep_session_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_task_ingredient" ON "prep_task" ("ingredient_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_task_prep_component" ON "prep_task" ("prep_component_id");`,

  // 5. ingredient_cross_usage.ingredient_id (T6 re-key) -----------------------
  `ALTER TABLE "ingredient_cross_usage" ADD COLUMN IF NOT EXISTS "ingredient_id" uuid REFERENCES "ingredient"("ingredient_id");`,

  // 6. prep_session.is_ended_ind — marks a session as closed so getTodaySession skips it
  `ALTER TABLE "prep_session" ADD COLUMN IF NOT EXISTS "is_ended_ind" boolean NOT NULL DEFAULT false;`,

  // 7. Missing FK indexes on existing tables (P0 #6 from audit) ----------------
  `CREATE INDEX IF NOT EXISTS "idx_prep_session_user" ON "prep_session" ("user_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_session_org" ON "prep_session" ("organisation_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_session_location" ON "prep_session" ("store_location_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_menu_selection_session" ON "prep_menu_selection" ("prep_session_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_menu_selection_recipe" ON "prep_menu_selection" ("recipe_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_prep_menu_selection_menu_item" ON "prep_menu_selection" ("menu_item_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_cross_usage_user" ON "ingredient_cross_usage" ("user_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_cross_usage_session" ON "ingredient_cross_usage" ("prep_session_id");`,

  // 8. ON DELETE rules for prep_task + prep_menu_selection FKs (P0 #7 from audit, lesson 0a687e3)
  `ALTER TABLE "prep_task"
     DROP CONSTRAINT IF EXISTS "prep_task_menu_item_id_menu_item_menu_item_id_fk";`,
  `ALTER TABLE "prep_task"
     DROP CONSTRAINT IF EXISTS "prep_task_menu_item_id_fkey";`,
  `ALTER TABLE "prep_task"
     ADD CONSTRAINT "prep_task_menu_item_id_fkey"
       FOREIGN KEY ("menu_item_id") REFERENCES "menu_item"("menu_item_id") ON DELETE SET NULL;`,
  `ALTER TABLE "prep_menu_selection"
     DROP CONSTRAINT IF EXISTS "prep_menu_selection_menu_item_id_menu_item_menu_item_id_fk";`,
  `ALTER TABLE "prep_menu_selection"
     DROP CONSTRAINT IF EXISTS "prep_menu_selection_menu_item_id_fkey";`,
  `ALTER TABLE "prep_menu_selection"
     ADD CONSTRAINT "prep_menu_selection_menu_item_id_fkey"
       FOREIGN KEY ("menu_item_id") REFERENCES "menu_item"("menu_item_id") ON DELETE SET NULL;`,
];

try {
  await sql.begin(async (tx) => {
    for (const s of stmts) {
      const head = s.replace(/\s+/g, " ").slice(0, 80);
      console.log("→", head, "…");
      await tx.unsafe(s);
    }
  });
  console.log("\n✓ Prep-component migration applied (idempotent, transactional).");
  console.log("  Next: npx tsx scripts/check-prep-components.ts");
} catch (err) {
  console.error("Migration failed (rolled back):", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
