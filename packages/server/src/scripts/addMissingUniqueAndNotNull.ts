/**
 * One-off: bring production's unique constraints and NOT NULLs in line with schema.ts
 * (found by checkSchemaDrift.ts). These tables were created by raw SQL that skipped them:
 *   UNIQUE   bench_channel.channel_key, guide.guide_key, model_option.model_id,
 *            recipe.slug, store_location.store_key
 *   UNIQUE INDEX idx_roster_role_org_location_name (roster_role)
 *   NOT NULL refresh_token.expires_at_dttm, refresh_token.created_dttm,
 *            user_organisation.user_id, .organisation_id, .role
 *
 * Strict and all-or-nothing, in one transaction with SET LOCAL lock_timeout:
 * refuses, changing nothing, if existing rows would violate any of them (duplicates or
 * NULLs). Idempotent: anything already present is skipped. Never deletes or edits data.
 *
 * Rollback: ALTER TABLE <t> DROP CONSTRAINT <t>_<col>_key; DROP INDEX
 * idx_roster_role_org_location_name; ALTER TABLE <t> ALTER COLUMN <c> DROP NOT NULL.
 *
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addMissingUniqueAndNotNull.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addMissingUniqueAndNotNull.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

// Identifiers come from these constants, never from input, so sql.raw is safe.
const UNIQUES: ReadonlyArray<readonly [string, string]> = [
  ["bench_channel", "channel_key"],
  ["guide", "guide_key"],
  ["model_option", "model_id"],
  ["recipe", "slug"],
  ["store_location", "store_key"],
];
const NOT_NULLS: ReadonlyArray<readonly [string, string]> = [
  ["refresh_token", "expires_at_dttm"],
  ["refresh_token", "created_dttm"],
  ["user_organisation", "user_id"],
  ["user_organisation", "organisation_id"],
  ["user_organisation", "role"],
];
const ROSTER_ROLE_INDEX = "idx_roster_role_org_location_name";
const q = (id: string) => sql.raw(`"${id}"`);

await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  const problems: string[] = [];

  for (const [t, c] of UNIQUES) {
    const [r] = await tx.execute(sql`SELECT count(*) - count(DISTINCT ${q(c)}) AS dupes FROM ${q(t)}`);
    if (Number(r.dupes) > 0) problems.push(`${t}.${c}: ${r.dupes} duplicate value(s)`);
  }
  for (const [t, c] of NOT_NULLS) {
    const [r] = await tx.execute(sql`SELECT count(*) AS n FROM ${q(t)} WHERE ${q(c)} IS NULL`);
    if (Number(r.n) > 0) problems.push(`${t}.${c}: ${r.n} NULL row(s)`);
  }
  const [rr] = await tx.execute(sql`
    SELECT count(*) AS dupes FROM (
      SELECT 1 FROM roster_role GROUP BY organisation_id, store_location_id, role_name HAVING count(*) > 1) d`);
  if (Number(rr.dupes) > 0) problems.push(`roster_role: ${rr.dupes} duplicate (organisation, location, role) group(s)`);
  if (problems.length) throw new Error("Refusing (nothing was changed):\n" + problems.join("\n"));

  for (const [t, c] of UNIQUES) {
    const has = await tx.execute(sql`
      SELECT 1 FROM pg_index i JOIN pg_class k ON k.oid = i.indrelid
      JOIN pg_attribute a ON a.attrelid = k.oid AND a.attnum = i.indkey[0]
      WHERE k.relname = ${t} AND k.relnamespace = 'public'::regnamespace AND i.indisunique
        AND i.indnkeyatts = 1 AND i.indpred IS NULL AND a.attname = ${c}`);
    if (has.length === 0) await tx.execute(sql`ALTER TABLE ${q(t)} ADD CONSTRAINT ${q(`${t}_${c}_key`)} UNIQUE (${q(c)})`);
  }
  await tx.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${q(ROSTER_ROLE_INDEX)}
    ON roster_role (organisation_id, store_location_id, role_name)`);
  for (const [t, c] of NOT_NULLS) await tx.execute(sql`ALTER TABLE ${q(t)} ALTER COLUMN ${q(c)} SET NOT NULL`);
});

console.log("addMissingUniqueAndNotNull: done");
process.exit(0);
