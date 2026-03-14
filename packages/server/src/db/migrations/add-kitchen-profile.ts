/**
 * Migration: Add kitchen_profile table for user personalization.
 *
 * Creates the kitchen_profile table which stores each user's culinary
 * preferences (skill level, cuisine style, dietary restrictions, equipment).
 * This data is injected into the AI system prompt to personalize responses.
 *
 * Run: tsx packages/server/src/db/migrations/add-kitchen-profile.ts
 */
import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString);

async function run() {
  console.log("Starting migration: add kitchen_profile...");

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS kitchen_profile (
        kitchen_profile_id   SERIAL PRIMARY KEY,
        user_id              INTEGER NOT NULL UNIQUE,
        skill_level          VARCHAR(50)  NOT NULL DEFAULT 'home_cook',
        cuisine_preferences  TEXT[]       NOT NULL DEFAULT '{}',
        dietary_restrictions TEXT[]       NOT NULL DEFAULT '{}',
        kitchen_equipment    TEXT[]       NOT NULL DEFAULT '{}',
        servings_default     INTEGER      NOT NULL DEFAULT 4,
        onboarding_done_ind  BOOLEAN      NOT NULL DEFAULT FALSE,
        created_dttm         TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_dttm         TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `;
    console.log("kitchen_profile table created.");
  } catch {
    console.log("kitchen_profile table already exists — skipping.");
  }

  // Index for fast user_id lookup (already unique but explicit index helps EXPLAIN)
  try {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_kitchen_profile_user_id
      ON kitchen_profile (user_id)
    `;
    console.log("kitchen_profile user_id index created.");
  } catch {
    console.log("kitchen_profile index already exists — skipping.");
  }

  console.log("Migration complete!");
  await sql.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
