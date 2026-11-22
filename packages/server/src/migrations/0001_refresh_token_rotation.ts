import type { Migration } from "./runner.js";

/**
 * Refresh-token rotation with reuse detection (mobile Wave 0, auth hardening).
 * Run BEFORE the server version that reads these columns deploys. The previous server version keeps
 * working afterwards: every new column has a default or is nullable.
 * `gen_random_uuid()` is built in from PostgreSQL 13; the volatile default rewrites this small table once.
 */
export const migration: Migration = {
  id: "0001_refresh_token_rotation",
  description: "refresh_token: family_id, signed_in_at_dttm, rotated_at_dttm and the lookup indexes",
  statements: [
    // Existing rows each get their own family (a legacy token is a family of one).
    `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "family_id" uuid DEFAULT gen_random_uuid() NOT NULL`,
    `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "signed_in_at_dttm" timestamp`,
    `ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "rotated_at_dttm" timestamp`,
    // Refresh: "find the row for the token hash presented".
    `CREATE INDEX IF NOT EXISTS "idx_refresh_token_hash" ON "refresh_token" ("token_hash")`,
    // Sign-out everywhere, password change, suspend and the per-user purge: "all rows of one user".
    `CREATE INDEX IF NOT EXISTS "idx_refresh_token_user_id" ON "refresh_token" ("user_id")`,
    // Reuse detection: "all rows of one family".
    `CREATE INDEX IF NOT EXISTS "idx_refresh_token_family_id" ON "refresh_token" ("family_id")`,
  ],
};
