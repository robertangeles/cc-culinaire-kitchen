/**
 * Migration: Add guest_session table and guest_session_token column
 * on conversation table for anonymous chat access.
 */
import type { Sql } from "postgres";

export async function up(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS guest_session (
      guest_session_id SERIAL PRIMARY KEY,
      session_token    VARCHAR(255) NOT NULL UNIQUE,
      sessions_used    INTEGER NOT NULL DEFAULT 0,
      created_dttm     TIMESTAMP NOT NULL DEFAULT NOW(),
      last_active_dttm TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE conversation
    ADD COLUMN IF NOT EXISTS guest_session_token VARCHAR(255)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_guest_token
    ON conversation (guest_session_token)
    WHERE guest_session_token IS NOT NULL
  `;
}
