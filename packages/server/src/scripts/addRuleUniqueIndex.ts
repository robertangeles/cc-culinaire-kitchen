/**
 * @module scripts/addRuleUniqueIndex
 *
 * Additive DDL: a partial unique index on `award_rule` and
 * `document_expiry_rule` enforcing "at most one active row per
 * (ruleType/documentType, jurisdiction)" at the DB layer — the backstop for
 * the auto-supersede close+insert pattern (`upsertAwardRule`,
 * `upsertExpiryRule`), which closes a TOCTOU race two concurrent creates
 * could otherwise hit (both see "no active row", both insert).
 *
 * `coalesce(jurisdiction, '')` is required, not decorative: a plain unique
 * index treats every NULL jurisdiction (= national) as distinct from every
 * other NULL, so two "national" rows for the same type would never
 * conflict without it.
 *
 * Idempotent (IF NOT EXISTS) — same discipline as every other script in
 * this directory. `drizzle-kit push` is forbidden in this repo.
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addRuleUniqueIndex.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addRuleUniqueIndex.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

async function main(): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_award_rule_one_active"
      ON "award_rule" ("rule_type", (coalesce("jurisdiction", '')))
      WHERE "effective_to" IS NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_expiry_rule_one_active"
      ON "document_expiry_rule" ("document_type", (coalesce("jurisdiction", '')))
      WHERE "effective_to" IS NULL
  `);

  const rows = await db.execute(
    sql`select indexname, tablename from pg_indexes
        where indexname in ('idx_award_rule_one_active', 'idx_document_expiry_rule_one_active')
        order by indexname`,
  );
  console.log("New partial unique indexes:", rows);
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("addRuleUniqueIndex.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Rule unique-index DDL failed:", err);
      process.exit(1);
    });
}
