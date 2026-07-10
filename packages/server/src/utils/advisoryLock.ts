/**
 * @module utils/advisoryLock
 *
 * Single-runner guard for scheduled jobs across multiple app instances (spec T15).
 *
 * Uses `pg_try_advisory_xact_lock` INSIDE a transaction, NOT the session-scoped
 * `pg_advisory_lock`. The driver (postgres.js) manages its own connection pool:
 * a session lock acquired on one pooled connection and released on another
 * unlocks nothing, so it leaks for the life of the physical connection and the
 * job silently skips forever after. A transaction-scoped lock is bound to the
 * transaction's single connection and auto-releases on commit/rollback — no leak.
 * (See tasks/lessons.md: pg-advisory-lock-pool-leak.)
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

/**
 * Run `fn` iff this instance wins the transaction-scoped advisory lock `key`.
 * If another instance (or an overlapping tick on this instance) already holds
 * it, `fn` is skipped. The lock releases automatically when the transaction
 * ends, including if `fn` throws.
 *
 * Keep `fn` fast and DB-bound — it runs inside the lock transaction, so a long
 * external await would hold the lock (and a pool connection) the whole time.
 *
 * @returns true if `fn` ran (lock acquired); false if the lock was busy.
 */
export async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${key}) AS locked`,
    )) as unknown as Array<{ locked: boolean }>;
    if (!rows[0]?.locked) return false;
    await fn();
    return true;
  });
}
