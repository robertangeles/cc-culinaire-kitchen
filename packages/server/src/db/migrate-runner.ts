/**
 * @module db/migrate-runner
 *
 * Non-interactive migration runner that executes raw SQL against the database.
 * Replaces `drizzle-kit push` for CI and automated environments where
 * interactive TTY prompts are not available.
 *
 * Each migration is idempotent — safe to re-run without data loss.
 * Uses IF NOT EXISTS / IF EXISTS guards on all DDL statements.
 *
 * Usage:
 * ```sh
 * cd packages/server
 * npx tsx src/db/migrate-runner.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

const postgres = (await import("postgres")).default;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

/** Run a single SQL statement with logging. */
async function run(label: string, query: string): Promise<void> {
  try {
    await sql.unsafe(query);
    console.log(`  ✓ ${label}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Ignore "already exists" errors for idempotency
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ⊘ ${label} (already exists, skipped)`);
    } else {
      console.error(`  ✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Migration definitions — add new migrations at the bottom
// ---------------------------------------------------------------------------

console.log("\n🔄 Running migrations...\n");

// --- 2026-04-07: model_option table + modelId on prompt/prompt_version ---

await run(
  "Create model_option table",
  `CREATE TABLE IF NOT EXISTS model_option (
    model_option_id SERIAL PRIMARY KEY,
    model_id VARCHAR(150) NOT NULL UNIQUE,
    display_name VARCHAR(200) NOT NULL,
    provider VARCHAR(80) NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'chat',
    context_length INTEGER,
    input_cost_per_m NUMERIC(10,4),
    output_cost_per_m NUMERIC(10,4),
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled_ind BOOLEAN NOT NULL DEFAULT true,
    created_dttm TIMESTAMP NOT NULL DEFAULT now(),
    updated_dttm TIMESTAMP NOT NULL DEFAULT now()
  )`
);

await run(
  "Add model_id column to prompt table",
  `ALTER TABLE prompt ADD COLUMN IF NOT EXISTS model_id VARCHAR(150)`
);

await run(
  "Add model_id column to prompt_version table",
  `ALTER TABLE prompt_version ADD COLUMN IF NOT EXISTS model_id VARCHAR(150)`
);

// --- Seed initial model options ---

const seedModels = [
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", sort: 0 },
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", provider: "anthropic", sort: 1 },
  { id: "google/gemini-2.5-flash-image", name: "Nano Banana (Gemini 2.5 Flash)", provider: "google", sort: 2 },
  { id: "google/gemini-3.1-flash-image-preview", name: "Nano Banana 2 (Gemini 3.1 Flash)", provider: "google", sort: 3 },
  { id: "perplexity/sonar-pro", name: "Sonar Pro", provider: "perplexity", sort: 4 },
];

for (const m of seedModels) {
  await run(
    `Seed model: ${m.name}`,
    `INSERT INTO model_option (model_id, display_name, provider, category, sort_order, enabled_ind)
     VALUES ('${m.id}', '${m.name}', '${m.provider}', 'chat', ${m.sort}, true)
     ON CONFLICT (model_id) DO NOTHING`
  );
}

// --- 2026-04-29: audit_log table (Phase 0 of catalog-spine initiative) ---

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
  )`
);

await run(
  "Index audit_log by entity",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`
);

await run(
  "Index audit_log by org + created",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(organisation_id, created_dttm DESC)`
);

await run(
  "Index audit_log by actor",
  `CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id)`
);

// --- 2026-04-29: ingredient soft-delete columns (Phase 0 of catalog-spine) ---

await run(
  "Add deleted_at to ingredient",
  `ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`
);

await run(
  "Add deleted_by to ingredient",
  `ALTER TABLE ingredient ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES "user"(user_id)`
);

await run(
  "Partial index on active ingredients",
  `CREATE INDEX IF NOT EXISTS idx_ingredient_active ON ingredient(organisation_id) WHERE deleted_at IS NULL`
);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log("\n✅ All migrations complete.\n");
await sql.end();
process.exit(0);
