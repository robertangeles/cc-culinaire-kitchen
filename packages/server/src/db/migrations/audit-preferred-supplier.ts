// @ts-nocheck
/**
 * Phase 0 audit: verify that ingredient_supplier.preferred_ind has exactly
 * ONE row marked TRUE per (organisation_id, ingredient_id) pair.
 *
 * The catalog-spine Phase 1 plan denormalises ingredient.preferred_unit_cost
 * (sourced from the preferred ingredient_supplier row). If that invariant is
 * violated — zero or multiple preferred rows — the trigger that maintains
 * the denorm has undefined behaviour and the displayed cost will be wrong.
 *
 * Run BEFORE Phase 1 ships:
 *   cd packages/server
 *   npx tsx src/db/migrations/audit-preferred-supplier.ts
 *
 * Read-only. Reports violations; does NOT auto-fix.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

console.log("\n🔍 Auditing ingredient_supplier.preferred_ind invariant...\n");

// 1) Ingredients that have suppliers but ZERO preferred row
const zeroPreferred = await sql`
  SELECT
    i.organisation_id,
    i.ingredient_id,
    i.ingredient_name,
    COUNT(s.ingredient_supplier_id) AS supplier_count
  FROM ingredient i
  JOIN ingredient_supplier s ON s.ingredient_id = i.ingredient_id
  GROUP BY i.organisation_id, i.ingredient_id, i.ingredient_name
  HAVING SUM(CASE WHEN s.preferred_ind = TRUE THEN 1 ELSE 0 END) = 0
  ORDER BY i.organisation_id, i.ingredient_name
`;

// 2) Ingredients with TWO OR MORE preferred rows
const multiplePreferred = await sql`
  SELECT
    i.organisation_id,
    i.ingredient_id,
    i.ingredient_name,
    SUM(CASE WHEN s.preferred_ind = TRUE THEN 1 ELSE 0 END) AS preferred_count
  FROM ingredient i
  JOIN ingredient_supplier s ON s.ingredient_id = i.ingredient_id
  GROUP BY i.organisation_id, i.ingredient_id, i.ingredient_name
  HAVING SUM(CASE WHEN s.preferred_ind = TRUE THEN 1 ELSE 0 END) > 1
  ORDER BY i.organisation_id, i.ingredient_name
`;

// 3) Total ingredients that have at least one supplier
const totals = await sql`
  SELECT COUNT(DISTINCT i.ingredient_id) AS total_with_suppliers
  FROM ingredient i
  JOIN ingredient_supplier s ON s.ingredient_id = i.ingredient_id
`;

const totalWithSuppliers = Number(totals[0]?.total_with_suppliers ?? 0);

console.log("─────────────────────────────────────────────────────────");
console.log(`Total ingredients with at least one supplier: ${totalWithSuppliers}`);
console.log("─────────────────────────────────────────────────────────");

console.log(`\n❓ Ingredients with ZERO preferred suppliers: ${zeroPreferred.length}`);
if (zeroPreferred.length > 0) {
  console.log("   (these need exactly one supplier flagged as preferred before Phase 1)");
  for (const row of zeroPreferred.slice(0, 20)) {
    console.log(`   • org=${row.organisation_id} ingredient_id=${row.ingredient_id} name="${row.ingredient_name}" suppliers=${row.supplier_count}`);
  }
  if (zeroPreferred.length > 20) {
    console.log(`   ... and ${zeroPreferred.length - 20} more`);
  }
}

console.log(`\n❗ Ingredients with MULTIPLE preferred suppliers: ${multiplePreferred.length}`);
if (multiplePreferred.length > 0) {
  console.log("   (these will produce undefined behaviour in the preferred-cost trigger — fix BEFORE Phase 1)");
  for (const row of multiplePreferred.slice(0, 20)) {
    console.log(`   • org=${row.organisation_id} ingredient_id=${row.ingredient_id} name="${row.ingredient_name}" preferred_count=${row.preferred_count}`);
  }
  if (multiplePreferred.length > 20) {
    console.log(`   ... and ${multiplePreferred.length - 20} more`);
  }
}

const violations = zeroPreferred.length + multiplePreferred.length;

console.log("\n─────────────────────────────────────────────────────────");
if (violations === 0) {
  console.log("✅ PASS — preferred_ind invariant holds across all ingredients with suppliers.");
  console.log("   Safe to ship Phase 1 catalog-spine work.");
} else {
  console.log(`⚠️  ${violations} violation(s) found. Fix before Phase 1 ships.`);
  console.log("   Suggested admin SQL (run per row, not in bulk):");
  console.log("     UPDATE ingredient_supplier SET preferred_ind = FALSE WHERE ingredient_id = '<id>';");
  console.log("     UPDATE ingredient_supplier SET preferred_ind = TRUE  WHERE ingredient_supplier_id = '<chosen>';");
}
console.log("─────────────────────────────────────────────────────────\n");

await sql.end();
process.exit(violations === 0 ? 0 : 1);
