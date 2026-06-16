---
title: Schema drift between Drizzle code and live DB (May 2026)
category: synthesis
created: 2026-05-26
updated: 2026-06-16
related: [[lessons-index]], [[technical-architecture]], [[data-flow-architecture]], [[dev-prod-db-separation]]
---

Catalog of every known drift between `packages/server/src/db/schema.ts` and the live Postgres database as of 2026-05-26, plus the safe workflow for fixing them.

## Why this matters

`drizzle-kit push` does a full schema diff against the live DB. When code and DB have drifted, push surfaces **all** changes at once — including unrelated, dangerous ones. Worse, push currently aborts on a postgres internal (`pg_stat_statements_info`) before the user even gets to approve or reject. **Do not run `drizzle-kit push` blind.** Apply targeted SQL via a tsx script (see pattern in `packages/server/scripts/apply-ckm-feedback.ts` and `scripts/fix-recipe-fk-cascade.ts`).

## Known drifts

### 1. `prep_task.recipe_id` — FK constraint missing entirely
- **Code** ([schema.ts:946](../../packages/server/src/db/schema.ts#L946)): declares `references(() => recipe.recipeId, { onDelete: "set null" })`
- **DB**: column exists, no FK constraint at all (verified 2026-05-26 via `information_schema.referential_constraints`)
- **Impact**: orphan `recipe_id` values are possible; the declared SET NULL behavior doesn't actually apply
- **Fix path**: `ALTER TABLE prep_task ADD CONSTRAINT prep_task_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES recipe(recipe_id) ON DELETE SET NULL;` — but verify no existing `recipe_id` values point to deleted recipes first or the ADD will fail

### 2. `knowledge_document.file_path` — column dropped from code, still in DB with 18 rows
- **Code**: column removed from `schema.ts`
- **DB**: column still present, 18 rows hold data
- **Impact**: `drizzle-kit push` wants to DROP the column = silent data loss
- **Fix path**: decide whether the column is genuinely obsolete. If yes, audit the 18 rows, migrate any retained data elsewhere (a JSONB `metadata` column, perhaps), then drop. If no, restore the column to `schema.ts`.

### 3. Five unique constraints declared but not on DB
- `guide.guide_key_unique` (11 rows)
- `model_option.model_id_unique` (8 rows)
- `bench_channel.channel_key_unique` (2 rows)
- `recipe.slug_unique` (25 rows)
- `store_location.store_key_unique` (2 rows)
- **Impact**: code assumes uniqueness; DB doesn't enforce it. Race conditions could create duplicates that the app then breaks on.
- **Fix path**: for each, run a `SELECT col, COUNT(*) FROM table GROUP BY col HAVING COUNT(*) > 1` check, dedupe if needed, then `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...)`.

### 4. `drizzle-kit push` aborts on `pg_stat_statements_info`
- **Symptom**: `cannot drop view pg_stat_statements_info because extension pg_stat_statements requires it (code 2BP01)`
- **Cause**: drizzle-kit's diff routine attempts to drop/recreate the pg-internal view. The `pg_stat_statements` extension owns it and postgres refuses.
- **Impact**: push will never complete on this DB until the drizzle-kit bug is fixed upstream OR the extension is removed (we want to keep it — it's how we observe query performance).
- **Workaround**: bypass push entirely. Use targeted tsx migration scripts.

## Safe workflow for schema changes

1. **Edit `schema.ts`** with the change.
2. **Write a tsx script** under `packages/server/scripts/` that runs ONLY the SQL needed for that change. Mirror the pattern in [apply-ckm-feedback.ts](../../packages/server/scripts/apply-ckm-feedback.ts) — `postgres` driver, `dotenv` from project root, `IF EXISTS` for idempotency.
3. **Write a verification script** that reads `information_schema` / `pg_constraint` to confirm the change is needed and to check constraint names match expectations BEFORE running the migration. (See [check-recipe-fks.ts](../../packages/server/scripts/check-recipe-fks.ts).)
4. **Run the migration script**, then re-run the verifier to confirm.
5. **Never** `drizzle-kit push` until this drift list is reduced to zero AND the `pg_stat_statements_info` bug is resolved.

## What landed 2026-05-26

Fixed two FK cascade rules so `purgeArchivedRecipes` could run:
- `recipe_version.recipe_id` → `ON DELETE CASCADE`
- `prep_menu_selection.recipe_id` → `ON DELETE SET NULL`

Both applied via `scripts/fix-recipe-fk-cascade.ts`. The third intended fix (`prep_task.recipe_id`) was dropped after verification revealed the FK doesn't exist in the DB at all (drift item #1 above).

## Additional drift discovered 2026-06-16

Found while evaluating whether to adopt drizzle-kit **versioned migrations** (generate/migrate) during the dev/prod DB split ([[dev-prod-db-separation]]). Method: generated a baseline `0000` from `schema.ts`, applied it to a throwaway empty DB, and diffed `pg_dump --schema-only` against a fresh prod snapshot. The diff confirmed all drift above **and** surfaced these new items. This is why versioned migrations were **not** adopted — a drizzle baseline can't faithfully represent the live DB until these are reconciled.

### 5. Prod has DB functions + triggers that `schema.ts` does not model
- `fn_recompute_menu_item_allergens(p_menu_item_id uuid)` — recomputes allergen flags from linked ingredients
- `fn_recompute_preferred_supplier_cost(p_ingredient_id uuid)`
- `trg_ingredient_preferred_cost_stale()` (trigger fn)
- `trg_ingredient_supplier_preferred_cost()` (trigger fn)
- **Impact**: Drizzle has no concept of these. `push`/`migrate` would never create them and a naive reconciliation that "makes the DB match schema.ts" could drop them. They are live business logic — treat as authoritative, model them as raw SQL in any future migration system.

### 6. Prod uses extensions not declared in code
- `citext` (used by `ingredient_alias.alias_text` — `citext` in prod, `text` in `schema.ts`), `uuid-ossp`, `pg_stat_statements`.
- **Impact**: `alias_text` type mismatch (citext vs text) would generate a spurious `ALTER ... TYPE` on every diff. `pg_stat_statements` is the cause of drift #4 above.

### 7. Indexes declared in `schema.ts` but absent on prod
- `idx_audit_log_org_created`, `idx_consumption_log_location`, `idx_consumption_log_org`, `idx_menu_item_ingredient_menu_item`, `idx_menu_item_store`, `idx_waste_log_store`, `idx_spend_threshold_unique` (unique).
- **Impact**: code/intent says these exist; prod lacks them. Each should be verified and created via a targeted tsx script (after confirming the query that justifies it). Until then, query plans on prod differ from what the code assumes.

### 8. FK constraint naming + a few `ON DELETE` clauses differ
- Prod constraints largely use Postgres `_fkey` default names; `schema.ts` generates verbose `<table>_<col>_<reftable>_<refcol>_fk` names. Structurally equivalent, but a name mismatch means a drizzle-generated `DROP CONSTRAINT <verbose>` would not find prod's `_fkey`-named constraint.
- A few FKs differ in `ON DELETE` (e.g. `*.preferred_supplier_id` is `ON DELETE SET NULL` in prod, unqualified in code).

## Related
- [[lessons-index]] — see lesson #50 for the rule
- [[technical-architecture]] — overall stack context
- [[data-flow-architecture]] — server startup sequence (the purge runs at startup)
- [[dev-prod-db-separation]] — the dev/prod split that surfaced drift items 5–8
