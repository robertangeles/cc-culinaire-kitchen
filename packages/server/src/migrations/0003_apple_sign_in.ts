import type { Migration } from "./runner.js";

/**
 * Sign in with Apple. Run BEFORE the server version that reads these deploys. The previous server version keeps
 * working afterwards: the new column is nullable and nothing there reads it, the new table is read by nothing there, and the two indexes are partial to
 * provider 'apple', a value no existing row has (the previous version only writes 'google').
 * Run `migrate.ts --dry-run` first: if `oauth_account` already holds an 'apple' row the unique index would refuse.
 */
export const migration: Migration = {
  id: "0003_apple_sign_in",
  description:
    "oauth_account.provider_refresh_token_enc, the unique indexes for an Apple subject and one Apple link per user, and apple_revocation_retries",
  statements: [
    // Apple's refresh token (encrypted), kept so deleting the account can revoke it at Apple.
    `ALTER TABLE "oauth_account" ADD COLUMN IF NOT EXISTS "provider_refresh_token_enc" text`,
    // "Find the account for this Apple subject"; also stops two racing first sign-ins from creating two accounts.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_oauth_account_apple_subject" ON "oauth_account" ("oauth_provider_id") WHERE "oauth_provider" = 'apple'`,
    // "Which Apple link does this user have" (link action, account deletion); at most one per user.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_oauth_account_apple_user" ON "oauth_account" ("user_id") WHERE "oauth_provider" = 'apple'`,
    // Apple tokens whose revoke failed after an account was deleted, for scripts/retryAppleRevocations.ts. Small, read whole: no index.
    `CREATE TABLE IF NOT EXISTS "apple_revocation_retries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "refresh_token_enc" text NOT NULL,
      "attempts" integer NOT NULL DEFAULT 1,
      "last_error" varchar(500),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`,
  ],
};
