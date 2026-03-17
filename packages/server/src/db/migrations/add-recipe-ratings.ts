// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS recipe_rating (
    rating_id    SERIAL PRIMARY KEY,
    recipe_id    UUID NOT NULL REFERENCES recipe(recipe_id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL,
    rating       SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_dttm TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_dttm TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_rating_unique ON recipe_rating(recipe_id, user_id)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS recipe_review (
    review_id    SERIAL PRIMARY KEY,
    recipe_id    UUID NOT NULL REFERENCES recipe(recipe_id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL,
    user_name    VARCHAR(100) NOT NULL,
    review_title VARCHAR(200),
    review_body  TEXT NOT NULL,
    rating       SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_dttm TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_recipe_review_recipe ON recipe_review(recipe_id)`);

console.log("Created recipe_rating and recipe_review tables");
await sql.end();
