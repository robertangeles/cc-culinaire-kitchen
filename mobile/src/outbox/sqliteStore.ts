import { getDb } from "../storage/db";
import type { OutboxEntry, OutboxStore } from "./outbox";
import { fromRow, toRow, type OutboxRow } from "./sqliteRows";

/** The phone's outbox on disk. Survives the app being killed, which is the whole point. */
export const sqliteOutboxStore: OutboxStore = {
  async list(): Promise<OutboxEntry[]> {
    const db = await getDb();
    return (await db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY created_at, id")).map(fromRow);
  },
  async put(e: OutboxEntry) {
    const db = await getDb();
    const r = toRow(e);
    await db.runAsync(
      `INSERT OR REPLACE INTO outbox (id, user_id, type, version, status, command, attempts, server_failures, next_attempt_at, created_at, updated_at, attention_reason, attention_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.user_id, r.type, r.version, r.status, r.command, r.attempts, r.server_failures, r.next_attempt_at, r.created_at, r.updated_at, r.attention_reason, r.attention_message,
    );
  },
  async remove(ids: string[]) {
    if (ids.length === 0) return;
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const id of ids) await db.runAsync("DELETE FROM outbox WHERE id = ?", id);
    });
  },
};
