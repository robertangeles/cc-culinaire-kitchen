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

// ── Read side: dashboards (Phase 3 T18) ──────────────────────────────────────
// Raw-SQL aggregates over the OLAP facts (per the DB standards: analytics never
// go through the ORM). Admin-only; consumed by Settings → Brain.

/** Recall hit-rate + latency, summary + daily series, over the last `days`. */
export interface RecallStats {
  totalRecalls: number;
  /** Fraction of recalls that returned at least one memory (0..1). */
  hitRate: number;
  avgHits: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  daily: Array<{ dateKey: number; recalls: number; avgHits: number; avgLatencyMs: number }>;
}

export async function getRecallStats(days = 30): Promise<RecallStats> {
  const [summary] = (await db.execute(sql`
    SELECT
      count(*)::int AS total_recalls,
      coalesce((count(*) FILTER (WHERE hit_count > 0))::float / nullif(count(*), 0), 0) AS hit_rate,
      coalesce(avg(hit_count), 0)::float AS avg_hits,
      coalesce(avg(latency_ms), 0)::float AS avg_latency_ms,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::float AS p95_latency_ms
    FROM fact_brain_recall
    WHERE recalled_dttm > now() - ${days} * interval '1 day'
  `)) as unknown as Array<{
    total_recalls: number;
    hit_rate: number;
    avg_hits: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
  }>;

  const daily = (await db.execute(sql`
    SELECT date_key,
           count(*)::int AS recalls,
           coalesce(avg(hit_count), 0)::float AS avg_hits,
           coalesce(avg(latency_ms), 0)::float AS avg_latency_ms
    FROM fact_brain_recall
    WHERE recalled_dttm > now() - ${days} * interval '1 day'
    GROUP BY date_key
    ORDER BY date_key
  `)) as unknown as Array<{ date_key: number; recalls: number; avg_hits: number; avg_latency_ms: number }>;

  return {
    totalRecalls: summary?.total_recalls ?? 0,
    hitRate: summary?.hit_rate ?? 0,
    avgHits: summary?.avg_hits ?? 0,
    avgLatencyMs: summary?.avg_latency_ms ?? 0,
    p95LatencyMs: summary?.p95_latency_ms ?? 0,
    daily: daily.map((d) => ({
      dateKey: d.date_key,
      recalls: d.recalls,
      avgHits: d.avg_hits,
      avgLatencyMs: d.avg_latency_ms,
    })),
  };
}

/** Corpus size: live status/scope breakdown + snapshot growth series + top orgs. */
export interface CorpusStats {
  totalMemories: number;
  byScope: { user: number; org: number };
  byStatus: Record<string, number>;
  growth: Array<{ dateKey: number; scopeKey: number; total: number }>;
  topOrgs: Array<{ organisationId: number; count: number }>;
}

export async function getCorpusStats(): Promise<CorpusStats> {
  // Live breakdown from the OLTP table (current truth).
  const breakdown = (await db.execute(sql`
    SELECT scope, status, count(*)::int AS n FROM brain_memory GROUP BY scope, status
  `)) as unknown as Array<{ scope: string; status: string; n: number }>;

  const byScope = { user: 0, org: 0 };
  const byStatus: Record<string, number> = {};
  let totalMemories = 0;
  for (const r of breakdown) {
    totalMemories += r.n;
    if (r.scope === "user") byScope.user += r.n;
    else if (r.scope === "org") byScope.org += r.n;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
  }

  // Growth over time from the nightly snapshots (per day + scope).
  const growth = (await db.execute(sql`
    SELECT date_key, scope_key, sum(memory_count)::int AS total
    FROM fact_brain_corpus
    GROUP BY date_key, scope_key
    ORDER BY date_key
  `)) as unknown as Array<{ date_key: number; scope_key: number; total: number }>;

  const topOrgs = (await db.execute(sql`
    SELECT organisation_id, count(*)::int AS n
    FROM brain_memory
    WHERE scope = 'org' AND organisation_id IS NOT NULL
    GROUP BY organisation_id
    ORDER BY n DESC
    LIMIT 5
  `)) as unknown as Array<{ organisation_id: number; n: number }>;

  return {
    totalMemories,
    byScope,
    byStatus,
    growth: growth.map((g) => ({ dateKey: g.date_key, scopeKey: g.scope_key, total: g.total })),
    topOrgs: topOrgs.map((o) => ({ organisationId: o.organisation_id, count: o.n })),
  };
}
