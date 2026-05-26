-- Fix recipe FK cascade rules so purgeArchivedRecipes can delete cleanly.
-- Surgical: only the three FKs blocking the purge. Run via psql.

BEGIN;

ALTER TABLE recipe_version
  DROP CONSTRAINT IF EXISTS recipe_version_recipe_id_fkey,
  ADD CONSTRAINT recipe_version_recipe_id_fkey
    FOREIGN KEY (recipe_id) REFERENCES recipe(recipe_id) ON DELETE CASCADE;

ALTER TABLE prep_task
  DROP CONSTRAINT IF EXISTS prep_task_recipe_id_fkey,
  ADD CONSTRAINT prep_task_recipe_id_fkey
    FOREIGN KEY (recipe_id) REFERENCES recipe(recipe_id) ON DELETE SET NULL;

ALTER TABLE prep_menu_selection
  DROP CONSTRAINT IF EXISTS prep_menu_selection_recipe_id_fkey,
  ADD CONSTRAINT prep_menu_selection_recipe_id_fkey
    FOREIGN KEY (recipe_id) REFERENCES recipe(recipe_id) ON DELETE SET NULL;

COMMIT;
