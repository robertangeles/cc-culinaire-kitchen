// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_dm_thread (
    dm_thread_id    SERIAL PRIMARY KEY,
    user_a_id       INTEGER NOT NULL,
    user_b_id       INTEGER NOT NULL,
    last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_dttm    TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bench_dm_thread_pair ON bench_dm_thread(user_a_id, user_b_id)`);

// Make channel_id nullable (DMs don't have a channel)
await sql.unsafe(`ALTER TABLE bench_message ALTER COLUMN channel_id DROP NOT NULL`);
await sql.unsafe(`ALTER TABLE bench_message ADD COLUMN IF NOT EXISTS dm_thread_id INTEGER REFERENCES bench_dm_thread(dm_thread_id)`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_bench_message_dm ON bench_message(dm_thread_id, created_dttm DESC)`);

console.log("Created bench_dm_thread table and updated bench_message for DMs");
await sql.end();
