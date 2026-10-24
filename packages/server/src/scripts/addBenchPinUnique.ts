/**
 * One-off: enforce one pin per message on bench_pin. schema.ts declares
 * message_id UNIQUE and benchService.pinMessage relies on it (`ON CONFLICT DO
 * NOTHING`), but production and dev were built without the constraint, so pinning
 * the same message twice would silently create duplicate pins.
 *
 * Refuses, changing nothing, if duplicates already exist (never deletes data).
 * Idempotent: skips if message_id already has a unique constraint. The constraint
 * name matches Drizzle's default for `.unique()` so schema.ts and the database agree.
 * Plain ADD CONSTRAINT takes a short lock; bench_pin is tiny.
 *
 * Rollback: ALTER TABLE bench_pin DROP CONSTRAINT IF EXISTS bench_pin_message_id_unique;
 *
 * Run:
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/addBenchPinUnique.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/addBenchPinUnique.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

const hasUnique = async (run: Pick<typeof db, "execute">) => {
  const rows = await run.execute(sql`
    SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'u' AND c.conrelid = 'bench_pin'::regclass AND a.attname = 'message_id' AND array_length(c.conkey, 1) = 1`);
  return rows.length > 0;
};

const added = await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  if (await hasUnique(tx)) return false;

  const dupes = await tx.execute(
    sql`SELECT message_id, count(*)::int AS n FROM bench_pin GROUP BY message_id HAVING count(*) > 1`,
  );
  if (dupes.length > 0) {
    throw new Error(`Refusing to add UNIQUE(message_id): ${dupes.length} message(s) are pinned more than once (nothing was changed).`);
  }
  await tx.execute(sql`ALTER TABLE bench_pin ADD CONSTRAINT bench_pin_message_id_unique UNIQUE (message_id)`);
  return true;
});

if (!(await hasUnique(db))) {
  console.error("addBenchPinUnique: verification failed, no UNIQUE(message_id) on bench_pin");
  process.exit(1);
}
console.log(`addBenchPinUnique: done, ${added ? "added" : "already present"}, bench_pin.message_id is unique`);
process.exit(0);
