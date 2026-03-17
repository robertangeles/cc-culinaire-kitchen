// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS restaurant_name VARCHAR(200)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS establishment_type VARCHAR(50)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS cuisine_identity VARCHAR(200)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS target_diner VARCHAR(200)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS price_point VARCHAR(20)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS restaurant_voice VARCHAR(200)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS sourcing_values TEXT[] DEFAULT '{}'`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS plating_style VARCHAR(20)`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS kitchen_constraints TEXT[] DEFAULT '{}'`);
await sql.unsafe(`ALTER TABLE kitchen_profile ADD COLUMN IF NOT EXISTS menu_needs TEXT[] DEFAULT '{}'`);

console.log("Added 10 restaurant profile columns to kitchen_profile");
await sql.end();
