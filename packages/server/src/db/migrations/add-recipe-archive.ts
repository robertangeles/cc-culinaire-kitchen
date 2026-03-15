// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);
await sql.unsafe(`ALTER TABLE recipe ADD COLUMN IF NOT EXISTS archived_ind BOOLEAN NOT NULL DEFAULT false`);
await sql.unsafe(`ALTER TABLE recipe ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
console.log("Added archive columns to recipe table");
await sql.end();
