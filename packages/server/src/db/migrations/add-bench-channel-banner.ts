// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`ALTER TABLE bench_channel ADD COLUMN IF NOT EXISTS channel_banner VARCHAR(500)`);

console.log("Added channel_banner column to bench_channel");
await sql.end();
