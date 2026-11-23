import { getDb } from "./db";

/** Empties every table in the phone's database: the count queue, the downloaded sheets, the saved user. Used when an account is deleted. */
export async function wipeLocalData(): Promise<void> {
  const db = await getDb();
  const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  if (tables.length === 0) return;
  await db.execAsync(tables.map((t) => `DELETE FROM "${t.name}";`).join(" "));
}
