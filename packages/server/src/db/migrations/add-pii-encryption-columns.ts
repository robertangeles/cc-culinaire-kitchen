// @ts-nocheck
/**
 * @module db/migrations/add-pii-encryption-columns
 *
 * Migration: Adds encryption columns alongside existing plaintext PII
 * columns in the user and organisation tables. This enables a zero-downtime
 * migration: plaintext columns remain during transition.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/migrations/add-pii-encryption-columns.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log("Starting migration: add PII encryption columns...");

  await sql.begin(async (tx) => {
    // -----------------------------------------------------------------------
    // User table encryption columns
    // -----------------------------------------------------------------------
    const userCheck = await tx`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'user' AND column_name = 'user_name_enc'
    `;
    if (userCheck.length === 0) {
      console.log("Adding encryption columns to user table...");
      await tx`ALTER TABLE "user" ADD COLUMN user_name_enc TEXT`;
      await tx`ALTER TABLE "user" ADD COLUMN user_name_iv VARCHAR(24)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_name_tag VARCHAR(32)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_email_enc TEXT`;
      await tx`ALTER TABLE "user" ADD COLUMN user_email_iv VARCHAR(24)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_email_tag VARCHAR(32)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_email_hash VARCHAR(64)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_bio_enc TEXT`;
      await tx`ALTER TABLE "user" ADD COLUMN user_bio_iv VARCHAR(24)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_bio_tag VARCHAR(32)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_address_enc TEXT`;
      await tx`ALTER TABLE "user" ADD COLUMN user_address_iv VARCHAR(24)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_address_tag VARCHAR(32)`;
      console.log("User encryption columns added.");
    } else {
      console.log("User encryption columns already exist — skipping.");
    }

    // -----------------------------------------------------------------------
    // Organisation table encryption columns
    // -----------------------------------------------------------------------
    const orgCheck = await tx`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organisation' AND column_name = 'org_name_enc'
    `;
    if (orgCheck.length === 0) {
      console.log("Adding encryption columns to organisation table...");
      await tx`ALTER TABLE organisation ADD COLUMN org_name_enc TEXT`;
      await tx`ALTER TABLE organisation ADD COLUMN org_name_iv VARCHAR(24)`;
      await tx`ALTER TABLE organisation ADD COLUMN org_name_tag VARCHAR(32)`;
      await tx`ALTER TABLE organisation ADD COLUMN org_email_enc TEXT`;
      await tx`ALTER TABLE organisation ADD COLUMN org_email_iv VARCHAR(24)`;
      await tx`ALTER TABLE organisation ADD COLUMN org_email_tag VARCHAR(32)`;
      await tx`ALTER TABLE organisation ADD COLUMN org_address_enc TEXT`;
      await tx`ALTER TABLE organisation ADD COLUMN org_address_iv VARCHAR(24)`;
      await tx`ALTER TABLE organisation ADD COLUMN org_address_tag VARCHAR(32)`;
      console.log("Organisation encryption columns added.");
    } else {
      console.log("Organisation encryption columns already exist — skipping.");
    }
  });

  console.log("Migration complete!");
  await sql.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
