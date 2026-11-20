import { getDb } from "./db";

/** Tiny key-value storage for JSON documents (the interface the tests fake in memory). */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const sqliteKv: KvStore = {
  async get(key) {
    const db = await getDb();
    return (await db.getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = ?", key))?.value ?? null;
  },
  async set(key, value) {
    const db = await getDb();
    await db.runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, value);
  },
  async delete(key) {
    const db = await getDb();
    await db.runAsync("DELETE FROM kv WHERE key = ?", key);
  },
};
