/**
 * @module db/migrations/add-address-bio-reset
 *
 * Migration: Adds structured address fields to user and organisation tables,
 * a bio field to user, and a password_reset table for forgot-password flow.
 *
 * For organisations, migrates existing `organisation_address` data into
 * `organisation_address_line1` before dropping the old column.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/migrations/add-address-bio-reset.ts
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
  console.log("Starting migration: address fields + bio + password_reset...");

  await sql.begin(async (tx) => {
    // -----------------------------------------------------------------------
    // 1. User table: add bio + address fields
    // -----------------------------------------------------------------------
    const userCols = await tx`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'user' AND column_name = 'user_bio'
    `;
    if (userCols.length === 0) {
      console.log("Adding user_bio, address fields to user table...");
      await tx`ALTER TABLE "user" ADD COLUMN user_bio VARCHAR(300)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_address_line1 VARCHAR(200)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_address_line2 VARCHAR(200)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_suburb VARCHAR(100)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_state VARCHAR(100)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_country VARCHAR(100)`;
      await tx`ALTER TABLE "user" ADD COLUMN user_postcode VARCHAR(20)`;
      console.log("User columns added.");
    } else {
      console.log("User address/bio columns already exist — skipping.");
    }

    // -----------------------------------------------------------------------
    // 2. Organisation table: add structured address, migrate old data, drop old column
    // -----------------------------------------------------------------------
    const orgNewCol = await tx`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organisation' AND column_name = 'organisation_address_line1'
    `;
    if (orgNewCol.length === 0) {
      console.log("Adding structured address fields to organisation table...");
      await tx`ALTER TABLE organisation ADD COLUMN organisation_address_line1 VARCHAR(200)`;
      await tx`ALTER TABLE organisation ADD COLUMN organisation_address_line2 VARCHAR(200)`;
      await tx`ALTER TABLE organisation ADD COLUMN organisation_suburb VARCHAR(100)`;
      await tx`ALTER TABLE organisation ADD COLUMN organisation_state VARCHAR(100)`;
      await tx`ALTER TABLE organisation ADD COLUMN organisation_country VARCHAR(100)`;
      await tx`ALTER TABLE organisation ADD COLUMN organisation_postcode VARCHAR(20)`;

      // Migrate existing data from old column
      const orgOldCol = await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'organisation' AND column_name = 'organisation_address'
      `;
      if (orgOldCol.length > 0) {
        console.log("Migrating existing organisation_address data to organisation_address_line1...");
        await tx`
          UPDATE organisation
          SET organisation_address_line1 = organisation_address
          WHERE organisation_address IS NOT NULL
        `;
        await tx`ALTER TABLE organisation DROP COLUMN organisation_address`;
        console.log("Old organisation_address column dropped.");
      }

      console.log("Organisation address columns added.");
    } else {
      console.log("Organisation address columns already exist — skipping.");
    }

    // -----------------------------------------------------------------------
    // 3. Create password_reset table
    // -----------------------------------------------------------------------
    const resetTable = await tx`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'password_reset'
    `;
    if (resetTable.length === 0) {
      console.log("Creating password_reset table...");
      await tx`
        CREATE TABLE password_reset (
          password_reset_id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          reset_token VARCHAR(255) NOT NULL,
          expires_at_dttm TIMESTAMP NOT NULL,
          used_ind BOOLEAN NOT NULL DEFAULT false,
          created_dttm TIMESTAMP NOT NULL DEFAULT now()
        )
      `;
      console.log("password_reset table created.");
    } else {
      console.log("password_reset table already exists — skipping.");
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
