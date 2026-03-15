// @ts-nocheck — one-time migration script
/**
 * Migration: add-recipe-table
 *
 * Creates the `recipe` table for persisting generated recipes.
 * Uses UUID primary keys for shareable URL slugs.
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
  console.log("Starting migration: add recipe table...");

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

    await sql`
      CREATE TABLE IF NOT EXISTS recipe (
        recipe_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id             INTEGER,
        domain              VARCHAR(20) NOT NULL DEFAULT 'recipe',
        title               VARCHAR(300) NOT NULL,
        description         TEXT,
        recipe_data         JSONB NOT NULL,
        editorial_content   TEXT,
        image_url           VARCHAR(500),
        image_prompt        TEXT,
        kitchen_context     TEXT,
        request_params      JSONB,
        is_public_ind       BOOLEAN NOT NULL DEFAULT false,
        gallery_featured_ind BOOLEAN NOT NULL DEFAULT false,
        view_count          INTEGER NOT NULL DEFAULT 0,
        created_dttm        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_dttm        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_recipe_user ON recipe(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_recipe_public ON recipe(is_public_ind, created_dttm DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_recipe_domain ON recipe(domain)`;

    console.log("✅ Recipe table created successfully");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

run();
