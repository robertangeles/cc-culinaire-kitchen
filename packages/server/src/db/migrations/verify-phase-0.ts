// @ts-nocheck
/**
 * Verify Phase 0 migrations landed correctly on the live DB.
 * Run AFTER phase-0-catalog-spine.ts.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

console.log("\n🔍 Verifying Phase 0 schema...\n");

// 1. audit_log table exists with all 10 columns
const auditCols = await sql`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'audit_log' ORDER BY ordinal_position
`;
console.log(`audit_log columns: ${auditCols.length}`);
for (const c of auditCols) {
  console.log(`  • ${c.column_name} (${c.data_type})`);
}

// 2. ingredient has soft-delete columns
const ingCols = await sql`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name = 'ingredient' AND column_name IN ('deleted_at', 'deleted_by')
`;
console.log(`\ningredient soft-delete columns: ${ingCols.length}/2`);
for (const c of ingCols) {
  console.log(`  • ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`);
}

// 3. Indexes exist
const indexes = await sql`
  SELECT indexname FROM pg_indexes
  WHERE tablename IN ('audit_log', 'ingredient')
  AND indexname IN ('idx_audit_log_entity', 'idx_audit_log_org_created', 'idx_audit_log_actor', 'idx_ingredient_active')
`;
console.log(`\nIndexes: ${indexes.length}/4`);
for (const i of indexes) {
  console.log(`  • ${i.indexname}`);
}

const expected = {
  auditCols: 10,
  ingCols: 2,
  indexes: 4,
};
const actual = {
  auditCols: auditCols.length,
  ingCols: ingCols.length,
  indexes: indexes.length,
};

const ok =
  actual.auditCols === expected.auditCols &&
  actual.ingCols === expected.ingCols &&
  actual.indexes === expected.indexes;

console.log("\n─────────────────────────────────────────────────────────");
if (ok) {
  console.log("✅ PASS — Phase 0 schema is correctly applied to the live DB.");
} else {
  console.log("❌ FAIL — schema does not match expectations.");
  console.log("   Expected:", expected);
  console.log("   Actual:  ", actual);
}
console.log("─────────────────────────────────────────────────────────\n");

await sql.end();
process.exit(ok ? 0 : 1);
