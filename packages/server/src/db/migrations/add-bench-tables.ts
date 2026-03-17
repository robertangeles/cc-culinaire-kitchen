// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_channel (
    channel_id      SERIAL PRIMARY KEY,
    channel_key     VARCHAR(50) NOT NULL UNIQUE,
    channel_name    VARCHAR(200) NOT NULL,
    channel_type    VARCHAR(20) NOT NULL,
    organisation_id INTEGER,
    created_dttm    TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_message (
    message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id    INTEGER NOT NULL REFERENCES bench_channel(channel_id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL,
    message_body  TEXT NOT NULL,
    message_type  VARCHAR(20) NOT NULL DEFAULT 'text',
    recipe_id     UUID,
    edited_ind    BOOLEAN NOT NULL DEFAULT false,
    deleted_ind   BOOLEAN NOT NULL DEFAULT false,
    created_dttm  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_dttm  TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_bench_message_channel ON bench_message(channel_id, created_dttm DESC)`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_bench_message_user ON bench_message(user_id)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_reaction (
    reaction_id   SERIAL PRIMARY KEY,
    message_id    UUID NOT NULL REFERENCES bench_message(message_id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL,
    emoji         VARCHAR(20) NOT NULL,
    created_dttm  TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bench_reaction_unique ON bench_reaction(message_id, user_id, emoji)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_mention (
    mention_id        SERIAL PRIMARY KEY,
    message_id        UUID NOT NULL REFERENCES bench_message(message_id) ON DELETE CASCADE,
    mentioned_user_id INTEGER NOT NULL,
    read_ind          BOOLEAN NOT NULL DEFAULT false,
    created_dttm      TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);
await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_bench_mention_user ON bench_mention(mentioned_user_id, read_ind)`);

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS bench_pin (
    pin_id        SERIAL PRIMARY KEY,
    message_id    UUID NOT NULL UNIQUE REFERENCES bench_message(message_id) ON DELETE CASCADE,
    channel_id    INTEGER NOT NULL REFERENCES bench_channel(channel_id) ON DELETE CASCADE,
    pinned_by     INTEGER NOT NULL,
    created_dttm  TIMESTAMP NOT NULL DEFAULT NOW()
  )
`);

// Seed the "Everyone" global channel
await sql.unsafe(`
  INSERT INTO bench_channel (channel_key, channel_name, channel_type)
  VALUES ('everyone', 'Everyone', 'global')
  ON CONFLICT (channel_key) DO NOTHING
`);

console.log("Created bench tables and seeded 'Everyone' channel");
await sql.end();
