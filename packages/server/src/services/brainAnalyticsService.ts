/**
 * @module services/brainAnalyticsService
 *
 * Write side of the Brain analytics star schema (Phase 3 prep). Captures the
 * time-series signal Phase 3's design is gated on, into the OLAP tables
 * (`fact_brain_recall`, `fact_brain_corpus`) separate from OLTP `brain_memory`:
 *   - {@link recordRecall} — one fact row per recall + a recency stamp on the
 *     recalled memories (T18 hit-rate/latency, T16 recency). Best-effort and
 *     fire-and-forget: it NEVER blocks or breaks recall (same posture as capture).
 *   - {@link snapshotCorpus} — nightly per-tenant/scope corpus counts (T16 growth,
 *     T17 density). Idempotent: deletes the day's rows before re-inserting.
 *
 * `date_key` is derived from the DB clock (`now()`), not the app clock, so it
 * always agrees with the row's `recalled_dttm` / snapshot time.
 */

import { inArray, sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { brainMemory } from "../db/schema.js";

const logger = pino({ name: "brainAnalytics" });

/** Scope dimension keys (mirror the `dim_scope` seed). */
const SCOPE_KEY = { user: 1, org: 2 } as const;

export interface RecordRecallParams {
  userId: number;
  /** Set when the recall included the active-org branch; null for user-only. */
  organisationId: number | null;
  hitCount: number;
  latencyMs: number;
  /** Ids of the memories that were surfaced — stamped as recently recalled. */
  recalledMemoryIds: string[];
}

/**
 * Record one recall event (T18) and stamp the recalled memories' recency (T16).
 * Fire-and-forget from the recall path (`void recordRecall(...)`) — it swallows
 * every error and never rejects, so analytics can never break chat.
 */
export async function recordRecall(params: RecordRecallParams): Promise<void> {
  try {
    if (!params.userId || params.userId <= 0) return;

    await db.execute(sql`
      INSERT INTO fact_brain_recall (user_id, organisation_id, date_key, hit_count, latency_ms)
      VALUES (
        ${params.userId},
        ${params.organisationId},
        to_char(now(), 'YYYYMMDD')::int,
        ${params.hitCount},
        ${params.latencyMs}
      )
    `);

    if (params.recalledMemoryIds.length > 0) {
      await db
        .update(brainMemory)
        .set({ lastRecalledDttm: new Date() })
        .where(inArray(brainMemory.memoryId, params.recalledMemoryIds));
    }
  } catch (err) {
    // Best-effort: analytics must never affect the recall path.
    logger.warn({ err, userId: params.userId }, "brain.analytics.recall_write_failed");
  }
}

/**
 * Nightly snapshot of corpus size per (tenant, scope) into `fact_brain_corpus`
 * (T16 growth, T17 density). Idempotent by day: deletes today's rows first, then
 * inserts one row per user (scope=user) and per org (scope=org). Runs inside the
 * scheduler's `withAdvisoryLock` so only one instance writes.
 */
export async function snapshotCorpus(): Promise<void> {
  // Idempotent for the day — a re-run replaces today's snapshot.
  await db.execute(sql`DELETE FROM fact_brain_corpus WHERE date_key = to_char(now(), 'YYYYMMDD')::int`);

  // User-scope: one row per user with private memories.
  await db.execute(sql`
    INSERT INTO fact_brain_corpus
      (date_key, scope_key, user_id, organisation_id, memory_count, ready_count, pending_count, failed_count)
    SELECT
      to_char(now(), 'YYYYMMDD')::int, ${SCOPE_KEY.user}, user_id, NULL,
      count(*)::int,
      count(*) FILTER (WHERE status = 'ready')::int,
      count(*) FILTER (WHERE status IN ('pending', 'processing'))::int,
      count(*) FILTER (WHERE status = 'failed')::int
    FROM brain_memory
    WHERE scope = 'user'
    GROUP BY user_id
  `);

  // Org-scope: one row per org with shared memories.
  await db.execute(sql`
    INSERT INTO fact_brain_corpus
      (date_key, scope_key, user_id, organisation_id, memory_count, ready_count, pending_count, failed_count)
    SELECT
      to_char(now(), 'YYYYMMDD')::int, ${SCOPE_KEY.org}, NULL, organisation_id,
      count(*)::int,
      count(*) FILTER (WHERE status = 'ready')::int,
      count(*) FILTER (WHERE status IN ('pending', 'processing'))::int,
      count(*) FILTER (WHERE status = 'failed')::int
    FROM brain_memory
    WHERE scope = 'org' AND organisation_id IS NOT NULL
    GROUP BY organisation_id
  `);

  logger.info("brain.analytics.corpus_snapshot_written");
}
