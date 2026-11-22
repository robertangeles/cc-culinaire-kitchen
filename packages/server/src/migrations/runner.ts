/**
 * @module migrations/runner
 *
 * The ordered, recorded way a schema change reaches a real database.
 *
 * Production has drifted from `db/schema.ts`, so whole-schema tools (`drizzle-kit push`,
 * `generate`, `migrate`) are off the table (tasks/lessons.md #50, #52, #56). Instead every change is a
 * numbered migration in `src/migrations/`: a list of idempotent SQL statements. This runner
 *   - keeps a ledger (`schema_migrations`) of what has been applied, so "what is live?" has an answer;
 *   - applies pending migrations in id order, each in its own transaction under an advisory lock,
 *     so two runners cannot both apply one and a failure leaves the migration unrecorded;
 *   - can report what is pending (`--dry-run`) without touching anything.
 *
 * Statements must stay safe to re-run (`IF NOT EXISTS`, guarded `ADD CONSTRAINT`): a hand-run script
 * that predates the ledger may already have applied the change. A statement that cannot run inside a
 * transaction (`CREATE INDEX CONCURRENTLY`) is not supported yet; add a per-migration flag when one needs it.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "../services/auditService.js";
import { ADVISORY_LOCK_KEYS } from "../db/advisoryLockKeys.js";

export interface Migration {
  /** `NNNN_snake_case`; applied in ascending order of this string. */
  id: string;
  description: string;
  /** Idempotent SQL, run in order inside one transaction. */
  statements: string[];
}

type TransactionalDb = DbOrTx & { transaction: <T>(fn: (tx: DbOrTx) => Promise<T>) => Promise<T> };

export function assertOrdered(migrations: Migration[]): void {
  const ids = migrations.map((m) => m.id);
  for (const id of ids) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(id)) throw new Error(`Migration id "${id}" must look like 0001_snake_case`);
  }
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate migration id");
  if ([...ids].sort().join() !== ids.join()) throw new Error("Migrations must be listed in ascending id order");
}

async function ensureLedger(db: DbOrTx): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id text PRIMARY KEY,
      description text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function appliedMigrationIds(db: DbOrTx): Promise<string[]> {
  await ensureLedger(db);
  const rows = (await db.execute(sql`SELECT migration_id FROM schema_migrations ORDER BY migration_id`)) as unknown as Array<{
    migration_id: string;
  }>;
  return rows.map((r) => r.migration_id);
}

export async function pendingMigrations(db: DbOrTx, all: Migration[]): Promise<Migration[]> {
  assertOrdered(all);
  const applied = new Set(await appliedMigrationIds(db));
  return all.filter((m) => !applied.has(m.id));
}

/** Applies every pending migration in order; returns the ids it applied. `dryRun` applies nothing. */
export async function runMigrations(db: TransactionalDb, all: Migration[], opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const pending = await pendingMigrations(db, all);
  if (opts.dryRun) return pending.map((m) => m.id);

  const applied: string[] = [];
  for (const m of pending) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.schemaMigrations})`);
      // Another runner may have applied it while this one waited for the lock.
      const done = (await tx.execute(sql`SELECT 1 FROM schema_migrations WHERE migration_id = ${m.id}`)) as unknown as unknown[];
      if (done.length > 0) return;
      for (const statement of m.statements) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO schema_migrations (migration_id, description) VALUES (${m.id}, ${m.description})`);
      applied.push(m.id);
    });
  }
  return applied;
}
