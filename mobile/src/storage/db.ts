import * as SQLite from "expo-sqlite";

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

/** The phone's one local database, created on first use. Holds the outbox and a small key-value table. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  opened ??= (async () => {
    const db = await SQLite.openDatabaseAsync("culinaire.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        command TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        attention_reason TEXT,
        attention_message TEXT
      );
      -- Serves: drain (one account's SAVED_LOCAL rows), the needs-attention list, and the per-area submit gate.
      CREATE INDEX IF NOT EXISTS idx_outbox_user_status ON outbox (user_id, status);
      -- Small JSON documents the app reopens from offline: the last user and location, the downloaded count sheets.
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    return db;
  })();
  return opened;
}
