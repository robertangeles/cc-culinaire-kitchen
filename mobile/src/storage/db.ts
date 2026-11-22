import * as SQLite from "expo-sqlite";

/** Columns added to `outbox` after its first release, for phones that already have the table. */
const outboxColumnsAdded: Array<[string, string]> = [
  ["type", "TEXT NOT NULL DEFAULT 'count.saveLine'"],
  ["version", "INTEGER NOT NULL DEFAULT 1"],
  ["server_failures", "INTEGER NOT NULL DEFAULT 0"],
];

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
        type TEXT NOT NULL DEFAULT 'count.saveLine',
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        command TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        server_failures INTEGER NOT NULL DEFAULT 0,
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
    // A phone that already ran the count-only outbox has the table without the command columns: add them (existing rows are counts).
    const have = new Set((await db.getAllAsync<{ name: string }>("PRAGMA table_info(outbox)")).map((c) => c.name));
    for (const [column, ddl] of outboxColumnsAdded) if (!have.has(column)) await db.execAsync(`ALTER TABLE outbox ADD COLUMN ${column} ${ddl}`);
    return db;
  })();
  return opened;
}
