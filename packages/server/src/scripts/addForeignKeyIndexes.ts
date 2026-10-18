/**
 * One-off: index every foreign key that had no index on its leading column
 * (51 of them, found by comparing schema.ts and the live catalog). Without an
 * index, deleting a parent row (a user, a location, an ingredient) makes
 * Postgres scan the whole child table to check the constraint, and any lookup by
 * that column is a full scan. House rule: every FK gets an index.
 *
 * Additive and idempotent (IF NOT EXISTS). `drizzle-kit push` is forbidden in
 * this repo: it diffs the whole database and would drop live columns it does
 * not know about. One transaction with SET LOCAL lock_timeout so the build gives
 * up after 5s instead of queueing behind a long transaction; plain CREATE INDEX
 * holds a short write lock per table, fine at these sizes (largest affected
 * table was 167 rows in prod). Switch to CONCURRENTLY, with an indisvalid check,
 * if a table here ever gets large.
 *
 * Definitions must match schema.ts exactly (name, column, btree, no WHERE), or a
 * later schema diff will try to drop and recreate them.
 *
 * Rollback: DROP INDEX IF EXISTS <name>; for each name below.
 *
 * Run (dev first, where already-present indexes make it a no-op; then prod after a backup):
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addForeignKeyIndexes.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addForeignKeyIndexes.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

// [index name, table, column]
const FK_INDEXES: ReadonlyArray<readonly [string, string, string]> = [
  ["idx_consumption_log_user_id", "consumption_log", "user_id"],
  ["idx_credit_note_created_by_user_id", "credit_note", "created_by_user_id"],
  ["idx_discrepancy_photo_uploaded_by_user_id", "discrepancy_photo", "uploaded_by_user_id"],
  ["idx_fifo_batch_ingredient_id", "fifo_batch", "ingredient_id"],
  ["idx_forecast_recommendation_organisation_id", "forecast_recommendation", "organisation_id"],
  ["idx_guide_updated_by", "guide", "updated_by"],
  ["idx_ingredient_deleted_by", "ingredient", "deleted_by"],
  ["idx_ingredient_preferred_supplier_id", "ingredient", "preferred_supplier_id"],
  ["idx_ingredient_alias_created_by_user_id", "ingredient_alias", "created_by_user_id"],
  ["idx_ingredient_cross_usage_ingredient_id", "ingredient_cross_usage", "ingredient_id"],
  ["idx_ingredient_cross_usage_prep_session_id", "ingredient_cross_usage", "prep_session_id"],
  ["idx_ingredient_cross_usage_user_id", "ingredient_cross_usage", "user_id"],
  ["idx_inventory_transfer_initiated_by_user_id", "inventory_transfer", "initiated_by_user_id"],
  ["idx_inventory_transfer_received_by_user_id", "inventory_transfer", "received_by_user_id"],
  ["idx_inventory_transfer_sent_by_user_id", "inventory_transfer", "sent_by_user_id"],
  ["idx_inventory_transfer_line_fifo_batch_id", "inventory_transfer_line", "fifo_batch_id"],
  ["idx_menu_item_linked_ingredient_id", "menu_item", "linked_ingredient_id"],
  ["idx_order_guide_created_by_user_id", "order_guide", "created_by_user_id"],
  ["idx_order_guide_store_location_id", "order_guide", "store_location_id"],
  ["idx_pending_catalog_request_created_ingredient_id", "pending_catalog_request", "created_ingredient_id"],
  ["idx_pending_catalog_request_requested_by_user_id", "pending_catalog_request", "requested_by_user_id"],
  ["idx_pending_catalog_request_reviewed_by_user_id", "pending_catalog_request", "reviewed_by_user_id"],
  ["idx_prep_task_menu_item_id", "prep_task", "menu_item_id"],
  ["idx_prep_task_recipe_id", "prep_task", "recipe_id"],
  ["idx_prep_task_user_id", "prep_task", "user_id"],
  ["idx_purchase_order_approved_by_user_id", "purchase_order", "approved_by_user_id"],
  ["idx_purchase_order_created_by_user_id", "purchase_order", "created_by_user_id"],
  ["idx_purchase_order_line_received_by_user_id", "purchase_order_line", "received_by_user_id"],
  ["idx_purchase_order_line_substituted_ingredient_id", "purchase_order_line", "substituted_ingredient_id"],
  ["idx_receiving_discrepancy_receiving_line_id", "receiving_discrepancy", "receiving_line_id"],
  ["idx_receiving_discrepancy_substituted_ingredient_id", "receiving_discrepancy", "substituted_ingredient_id"],
  ["idx_receiving_line_ingredient_id", "receiving_line", "ingredient_id"],
  ["idx_receiving_session_received_by_user_id", "receiving_session", "received_by_user_id"],
  ["idx_recipe_version_changed_by", "recipe_version", "changed_by"],
  ["idx_recipe_version_recipe_id", "recipe_version", "recipe_id"],
  ["idx_sale_created_by", "sale", "created_by"],
  ["idx_sale_voided_by", "sale", "voided_by"],
  ["idx_shift_created_by", "shift", "created_by"],
  ["idx_shift_swap_request_from_assignment_id", "shift_swap_request", "from_assignment_id"],
  ["idx_spend_threshold_created_by_user_id", "spend_threshold", "created_by_user_id"],
  ["idx_spend_threshold_store_location_id", "spend_threshold", "store_location_id"],
  ["idx_stock_level_last_counted_by_user_id", "stock_level", "last_counted_by_user_id"],
  ["idx_stock_take_category_claimed_by_user_id", "stock_take_category", "claimed_by_user_id"],
  ["idx_stock_take_session_approved_by_user_id", "stock_take_session", "approved_by_user_id"],
  ["idx_stock_take_session_opened_by_user_id", "stock_take_session", "opened_by_user_id"],
  ["idx_store_location_created_by", "store_location", "created_by"],
  ["idx_user_selected_organisation_id", "user", "selected_organisation_id"],
  ["idx_user_location_preference_store_location_id", "user_location_preference", "store_location_id"],
  ["idx_user_store_location_assigned_by", "user_store_location", "assigned_by"],
  ["idx_waste_log_organisation_id", "waste_log", "organisation_id"],
  ["idx_waste_log_user_id", "waste_log", "user_id"],
];

// Identifiers come from the constant above, never from input, so sql.raw is safe
// here. They are double-quoted because "user" is a reserved word.
await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  for (const [name, table, column] of FK_INDEXES) {
    await tx.execute(sql.raw(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" ("${column}")`));
  }
});

// IF NOT EXISTS matches on name only, so verify definition and validity, not just presence.
const rows = await db.execute(sql`
  SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(c.oid) AS definition
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname IN (${sql.join(FK_INDEXES.map(([name]) => sql`${name}`), sql`, `)})`);

const byName = new Map(rows.map((r) => [String(r.name), r]));
const problems: string[] = [];
for (const [name, table, column] of FK_INDEXES) {
  const row = byName.get(name);
  const expected = `CREATE INDEX ${name} ON public.${table} USING btree (${column})`;
  if (!row) problems.push(`${name}: missing`);
  else if (!row.valid) problems.push(`${name}: INVALID`);
  // pg_get_indexdef quotes reserved names ("user"); compare without quotes.
  else if (String(row.definition).replaceAll('"', "") !== expected) problems.push(`${name}: unexpected definition ${row.definition}`);
}
if (problems.length > 0) {
  console.error("addForeignKeyIndexes: verification failed\n" + problems.join("\n"));
  process.exit(1);
}

console.log(`addForeignKeyIndexes: done, ${FK_INDEXES.length} indexes present and valid`);
process.exit(0);
