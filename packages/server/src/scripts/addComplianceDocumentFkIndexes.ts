/**
 * One-off: index compliance_document.uploaded_by and .verified_by, the two
 * foreign keys to "user" that had no index. Without them, deleting a user makes
 * Postgres scan the whole table to check the constraint (house rule: every FK
 * gets an index).
 *
 * Additive and idempotent (IF NOT EXISTS). `drizzle-kit push` is forbidden in
 * this repo: it diffs the whole database and would drop live columns it does
 * not know about. Plain CREATE INDEX takes a short write lock on the table;
 * compliance_document is small, so that is milliseconds. Switch to CONCURRENTLY
 * (and check pg_index.indisvalid afterwards) if this table ever gets large.
 *
 * Rollback: DROP INDEX IF EXISTS idx_compliance_document_uploaded_by, idx_compliance_document_verified_by;
 * Definitions must match schema.ts exactly (name, column, btree, no WHERE), or a
 * later schema diff will try to drop and recreate them.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addComplianceDocumentFkIndexes.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addComplianceDocumentFkIndexes.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

// One transaction so SET LOCAL reaches both statements on the same pooled
// connection: the build gives up after 5s instead of queueing behind a long
// transaction and stalling every writer. IF NOT EXISTS matches on name only, so
// the verify step below checks the definitions, not just that the names exist.
await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_uploaded_by ON compliance_document (uploaded_by)`);
  await tx.execute(sql`CREATE INDEX IF NOT EXISTS idx_compliance_document_verified_by ON compliance_document (verified_by)`);
});

const verify = await db.execute(sql`
  SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(c.oid) AS definition
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname IN ('idx_compliance_document_uploaded_by', 'idx_compliance_document_verified_by')
  ORDER BY c.relname`);
console.log(verify);
if (verify.length !== 2 || verify.some((r) => !r.valid)) {
  console.error("addComplianceDocumentFkIndexes: expected two valid indexes");
  process.exit(1);
}

console.log("addComplianceDocumentFkIndexes: done");
process.exit(0);
