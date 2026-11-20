import * as SQLite from "expo-sqlite";
import type { OutboxEntry, OutboxStore } from "./outbox";
import { fromRow, toRow, type OutboxRow } from "./sqliteRows";

/** The phone's outbox on disk. Survives the app being killed, which is the whole point. */
export async function createSqliteOutboxStore(): Promise<OutboxStore> {
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
  `);

  return {
    async list(): Promise<OutboxEntry[]> {
      return (await db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY created_at, id")).map(fromRow);
    },
    async put(e: OutboxEntry) {
      const r = toRow(e);
      await db.runAsync(
        `INSERT OR REPLACE INTO outbox (id, user_id, status, command, attempts, next_attempt_at, created_at, updated_at, attention_reason, attention_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id, r.user_id, r.status, r.command, r.attempts, r.next_attempt_at, r.created_at, r.updated_at, r.attention_reason, r.attention_message,
      );
    },
    async remove(ids: string[]) {
      if (ids.length === 0) return;
      await db.withTransactionAsync(async () => {
        for (const id of ids) await db.runAsync("DELETE FROM outbox WHERE id = ?", id);
      });
    },
  };
}
