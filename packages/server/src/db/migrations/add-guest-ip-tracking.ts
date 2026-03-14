/**
 * Migration: Add ip_address column to guest_session table
 * for IP-based anti-abuse tracking.
 */
import type { Sql } from "postgres";

export async function up(sql: Sql) {
  await sql`
    ALTER TABLE guest_session
    ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_guest_session_ip
    ON guest_session (ip_address)
    WHERE ip_address IS NOT NULL
  `;
}
