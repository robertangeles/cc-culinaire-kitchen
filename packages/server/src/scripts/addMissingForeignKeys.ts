/**
 * One-off: add the foreign-key constraints that schema.ts declares but production
 * never got (31 of them). Whole tables (waste, prep, receiving, credit notes, spend
 * thresholds, notifications, ...) were created by raw SQL scripts without their
 * REFERENCES, so production could hold rows pointing at nothing while CI, which
 * builds its database from schema.ts, could not.
 *
 * Strict and all-or-nothing, in one transaction with SET LOCAL lock_timeout:
 *   1. Skip any foreign key that already exists on that column (idempotent).
 *   2. Refuse, changing nothing, if any row would violate a constraint it is about to
 *      get (orphan check), listing each offender with its count. This script never
 *      deletes data.
 *   3. ADD CONSTRAINT for the rest, then verify each exists, is validated, and points
 *      at the expected table, column and delete rule.
 *
 * Constraint names follow Postgres's default ({table}_{column}_fkey), matching the
 * constraints production already has. `drizzle-kit push` is forbidden in this repo.
 *
 * Rollback: ALTER TABLE <table> DROP CONSTRAINT IF EXISTS <table>_<column>_fkey; for
 * each entry below.
 *
 * Run (dev first; then prod after a backup):
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addMissingForeignKeys.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addMissingForeignKeys.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

type DeleteRule = "NO ACTION" | "SET NULL";

// [table, column, referenced table, referenced column, ON DELETE rule]
const FOREIGN_KEYS: ReadonlyArray<readonly [string, string, string, string, DeleteRule]> = [
  ["credit_note", "created_by_user_id", "user", "user_id", "NO ACTION"],
  ["credit_note", "discrepancy_id", "receiving_discrepancy", "discrepancy_id", "NO ACTION"],
  ["credit_note", "organisation_id", "organisation", "organisation_id", "NO ACTION"],
  ["credit_note", "supplier_id", "supplier", "supplier_id", "NO ACTION"],
  ["discrepancy_photo", "discrepancy_id", "receiving_discrepancy", "discrepancy_id", "NO ACTION"],
  ["discrepancy_photo", "uploaded_by_user_id", "user", "user_id", "NO ACTION"],
  ["ingredient_cross_usage", "prep_session_id", "prep_session", "prep_session_id", "NO ACTION"],
  ["ingredient_cross_usage", "user_id", "user", "user_id", "NO ACTION"],
  ["menu_item", "store_location_id", "store_location", "store_location_id", "NO ACTION"],
  ["menu_item", "user_id", "user", "user_id", "NO ACTION"],
  ["notification", "organisation_id", "organisation", "organisation_id", "NO ACTION"],
  ["notification", "recipient_user_id", "user", "user_id", "NO ACTION"],
  ["prep_session", "store_location_id", "store_location", "store_location_id", "NO ACTION"],
  ["prep_session", "user_id", "user", "user_id", "NO ACTION"],
  ["prep_task", "prep_session_id", "prep_session", "prep_session_id", "NO ACTION"],
  ["prep_task", "recipe_id", "recipe", "recipe_id", "SET NULL"],
  ["prep_task", "user_id", "user", "user_id", "NO ACTION"],
  ["receiving_discrepancy", "receiving_line_id", "receiving_line", "receiving_line_id", "NO ACTION"],
  ["receiving_discrepancy", "session_id", "receiving_session", "session_id", "NO ACTION"],
  ["receiving_discrepancy", "substituted_ingredient_id", "ingredient", "ingredient_id", "NO ACTION"],
  ["receiving_discrepancy", "supplier_id", "supplier", "supplier_id", "NO ACTION"],
  ["receiving_line", "ingredient_id", "ingredient", "ingredient_id", "NO ACTION"],
  ["receiving_line", "po_line_id", "purchase_order_line", "line_id", "NO ACTION"],
  ["receiving_line", "session_id", "receiving_session", "session_id", "NO ACTION"],
  ["receiving_session", "po_id", "purchase_order", "po_id", "NO ACTION"],
  ["receiving_session", "received_by_user_id", "user", "user_id", "NO ACTION"],
  ["receiving_session", "store_location_id", "store_location", "store_location_id", "NO ACTION"],
  ["spend_threshold", "created_by_user_id", "user", "user_id", "NO ACTION"],
  ["spend_threshold", "organisation_id", "organisation", "organisation_id", "NO ACTION"],
  ["spend_threshold", "store_location_id", "store_location", "store_location_id", "NO ACTION"],
  ["waste_log", "store_location_id", "store_location", "store_location_id", "NO ACTION"],
  ["waste_log", "user_id", "user", "user_id", "NO ACTION"],
];

// pg_constraint.confdeltype letters.
const DELETE_RULE_CODE: Record<DeleteRule, string> = { "NO ACTION": "a", "SET NULL": "n" };

const constraintName = (table: string, column: string) => `${table}_${column}_fkey`;

// Identifiers come from the constant above, never from input, so sql.raw is safe here.
// They are double-quoted because some names are reserved words.
const q = (identifier: string) => `"${identifier}"`;

async function existingForeignKeyColumns(run: Pick<typeof db, "execute">): Promise<Set<string>> {
  const rows = await run.execute(sql`
    SELECT replace(c.conrelid::regclass::text, '"', '') AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  return new Set(rows.map((r) => `${r.tbl}.${r.col}`));
}

const toAdd = await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

  const existing = await existingForeignKeyColumns(tx);
  const pending = FOREIGN_KEYS.filter(([table, column]) => !existing.has(`${table}.${column}`));

  const orphaned: string[] = [];
  for (const [table, column, refTable, refColumn] of pending) {
    const [{ n }] = await tx.execute<{ n: number }>(
      sql.raw(
        `SELECT count(*)::int AS n FROM ${q(table)} x WHERE x.${q(column)} IS NOT NULL ` +
          `AND NOT EXISTS (SELECT 1 FROM ${q(refTable)} p WHERE p.${q(refColumn)} = x.${q(column)})`,
      ),
    );
    if (n > 0) orphaned.push(`${table}.${column} -> ${refTable}: ${n} orphan row(s)`);
  }
  if (orphaned.length > 0) {
    throw new Error(
      "Refusing to add foreign keys: these rows would violate them (nothing was changed):\n" + orphaned.join("\n"),
    );
  }

  for (const [table, column, refTable, refColumn, onDelete] of pending) {
    await tx.execute(
      sql.raw(
        `ALTER TABLE ${q(table)} ADD CONSTRAINT ${q(constraintName(table, column))} ` +
          `FOREIGN KEY (${q(column)}) REFERENCES ${q(refTable)} (${q(refColumn)}) ON DELETE ${onDelete}`,
      ),
    );
  }
  return pending.length;
});

// Verify every entry, including ones that already existed: present, validated, right target and rule.
const rows = await db.execute(sql`
  SELECT replace(c.conrelid::regclass::text, '"', '') AS tbl, a.attname AS col,
         replace(c.confrelid::regclass::text, '"', '') AS ref_tbl, c.convalidated AS validated,
         c.confdeltype AS del_type
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
const byColumn = new Map(rows.map((r) => [`${r.tbl}.${r.col}`, r]));

const problems: string[] = [];
for (const [table, column, refTable, , onDelete] of FOREIGN_KEYS) {
  const row = byColumn.get(`${table}.${column}`);
  if (!row) problems.push(`${table}.${column}: missing`);
  else if (!row.validated) problems.push(`${table}.${column}: NOT VALIDATED`);
  else if (row.ref_tbl !== refTable) problems.push(`${table}.${column}: points at ${row.ref_tbl}, expected ${refTable}`);
  else if (row.del_type !== DELETE_RULE_CODE[onDelete]) problems.push(`${table}.${column}: delete rule ${row.del_type}, expected ${onDelete}`);
}
if (problems.length > 0) {
  console.error("addMissingForeignKeys: verification failed\n" + problems.join("\n"));
  process.exit(1);
}

console.log(`addMissingForeignKeys: done, added ${toAdd}, ${FOREIGN_KEYS.length} foreign keys present and valid`);
process.exit(0);
