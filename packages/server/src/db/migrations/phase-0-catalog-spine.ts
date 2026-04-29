// @ts-nocheck
/**
 * Phase 0 of catalog-spine — applies just the new DDL needed for Phase 0
 * without touching unrelated migrations that may have pre-existing issues.
 *
 * Idempotent — uses IF NOT EXISTS guards on every statement.
 *
 * Run:
 *   cd packages/server
 *   npx tsx src/db/migrations/phase-0-catalog-spine.ts
 *
 * Migrations applied:
 *   1. audit_log table + 3 indexes (project-wide audit trail)
 *   2. ingredient.deleted_at + ingredient.deleted_by (soft-delete columns)
 *   3. idx_ingredient_active partial index (hot path for picker queries)
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

async function run(label: string, query: string): Promise<void> {
  try {
    await sql.unsafe(query);
    console.log(`  ✓ ${label}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ⊘ ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

console.log("\n🔄 Applying Phase 0 catalog-spine migrations...\n");

// --- audit_log table ---

await run(
  "Create audit_log table",
  `CREATE TABLE IF NOT EXISTS audit_log (
    audit_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(30) NOT NULL,
    actor_user_id INTEGER REFERENCES "user"(user_id),
    organisation_id INTEGER REFERENCES organisation(organisation_id),
    before_value JSONB,
    after_value JSONB,
    metadata JSONB,
    created_dttm TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
);

await run(
  "Index audit_log by entity",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`,
);

await run(
  "Index audit_log by org + created",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(organisation_id, created_dttm DESC)`,
);

await run(
  "Index audit_log by actor",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id)`,
);

// --- ingredient soft-delete columns ---

await run(
  "Add deleted_at to ingredient",
  `ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
);

await run(
  "Add deleted_by to ingredient",
  `ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES "user"(user_id)`,
);

await run(
  "Partial index on active ingredients",
  `CREATE INDEX IF NOT EXISTS idx_ingredient_active ON ingredient(organisation_id) WHERE deleted_at IS NULL`,
);

console.log("\n✅ Phase 0 migrations complete.\n");

await sql.end();
process.exit(0);
