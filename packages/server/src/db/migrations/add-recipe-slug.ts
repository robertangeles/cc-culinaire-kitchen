// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);
await sql.unsafe(`ALTER TABLE recipe ADD COLUMN IF NOT EXISTS slug VARCHAR(400) UNIQUE`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_recipe_slug ON recipe(slug)`);
console.log("Added slug column to recipe table");
await sql.end();
