import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { recordRecall, snapshotCorpus, getRecallStats, getCorpusStats } = await import(
  "./brainAnalyticsService.js"
);
const { reembedFailedMemories } = await import("./brainService.js");

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();
if (!dbAvailable) {
  console.warn("brainAnalyticsService.test.ts: no local database reachable — suite skipped");
}

describe.runIf(dbAvailable)("brainAnalyticsService (Phase 3 prep, real DB)", () => {
  let userId = 0;
  let orgId = 0;
  const userMemIds: string[] = [];
  const key = (p: string) => `AN-${p}-${randomUUID().slice(0, 8)}`.toUpperCase();

  beforeAll(async () => {
    const [u] = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email)
      VALUES ('Analytics user', ${`an-${randomUUID()}@test.local`})
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    userId = u.user_id;

    const [o] = (await db.execute(sql`
      INSERT INTO organisation (organisation_name, join_key, created_by)
      VALUES ('Analytics Kitchen', ${key("org")}, ${userId})
      RETURNING organisation_id
    `)) as unknown as Array<{ organisation_id: number }>;
    orgId = o.organisation_id;

    // 2 user-scope (ready) + 3 org-scope (2 ready, 1 pending).
    const um = (await db.execute(sql`
      INSERT INTO brain_memory (user_id, organisation_id, scope, source_type, body, status) VALUES
        (${userId}, NULL, 'user', 'chat', 'private a', 'ready'),
        (${userId}, NULL, 'user', 'chat', 'private b', 'ready')
      RETURNING memory_id
    `)) as unknown as Array<{ memory_id: string }>;
    userMemIds.push(...um.map((r) => r.memory_id));

    await db.execute(sql`
      INSERT INTO brain_memory (user_id, organisation_id, scope, source_type, body, status) VALUES
        (${userId}, ${orgId}, 'org', 'waste', 'shared a', 'ready'),
        (${userId}, ${orgId}, 'org', 'recipe', 'shared b', 'ready'),
        (${userId}, ${orgId}, 'org', 'menu', 'shared c', 'pending')
    `);
  });

  afterAll(async () => {
    if (userId) {
      await db.execute(sql`DELETE FROM fact_brain_recall WHERE user_id = ${userId}`);
      await db.execute(
        sql`DELETE FROM fact_brain_corpus WHERE user_id = ${userId} OR organisation_id = ${orgId}`,
      );
      await db.execute(sql`DELETE FROM brain_memory WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM user_organisation WHERE organisation_id = ${orgId}`);
      await db.execute(sql`DELETE FROM organisation WHERE organisation_id = ${orgId}`);
      await db.execute(sql`DELETE FROM "user" WHERE user_id = ${userId}`);
    }
  });

  it("recordRecall: writes a fact_brain_recall row and stamps last_recalled_dttm (T18/T16)", async () => {
    await recordRecall({
      userId,
      organisationId: orgId,
      hitCount: 2,
      latencyMs: 42,
      recalledMemoryIds: userMemIds,
    });

    const [fact] = (await db.execute(sql`
      SELECT hit_count, latency_ms, organisation_id, date_key
      FROM fact_brain_recall WHERE user_id = ${userId}
    `)) as unknown as Array<{
      hit_count: number;
      latency_ms: number;
      organisation_id: number;
      date_key: number;
    }>;
    expect(fact.hit_count).toBe(2);
    expect(fact.latency_ms).toBe(42);
    expect(fact.organisation_id).toBe(orgId);
    // date_key is a valid conformed dimension key (present in dim_date).
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM dim_date WHERE date_key = ${fact.date_key}
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(1);

    const [{ stamped }] = (await db.execute(sql`
      SELECT count(*)::int AS stamped FROM brain_memory
      WHERE user_id = ${userId} AND scope = 'user' AND last_recalled_dttm IS NOT NULL
    `)) as unknown as Array<{ stamped: number }>;
    expect(stamped).toBe(2);
  });

  it("recordRecall: guest (userId <= 0) records nothing", async () => {
    await recordRecall({ userId: 0, organisationId: null, hitCount: 1, latencyMs: 1, recalledMemoryIds: [] });
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM fact_brain_recall WHERE user_id = 0
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(0);
  });

  it("snapshotCorpus: one row per tenant+scope with correct counts; idempotent per day (T16/T17)", async () => {
    await snapshotCorpus();

    const userRows = (await db.execute(sql`
      SELECT memory_count, ready_count, pending_count, failed_count, scope_key
      FROM fact_brain_corpus WHERE user_id = ${userId}
    `)) as unknown as Array<{
      memory_count: number;
      ready_count: number;
      pending_count: number;
      failed_count: number;
      scope_key: number;
    }>;
    expect(userRows).toHaveLength(1);
    expect(userRows[0].scope_key).toBe(1); // dim_scope: user
    expect(userRows[0].memory_count).toBe(2);
    expect(userRows[0].ready_count).toBe(2);

    const orgRows = (await db.execute(sql`
      SELECT memory_count, ready_count, pending_count, scope_key
      FROM fact_brain_corpus WHERE organisation_id = ${orgId}
    `)) as unknown as Array<{
      memory_count: number;
      ready_count: number;
      pending_count: number;
      scope_key: number;
    }>;
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0].scope_key).toBe(2); // dim_scope: org
    expect(orgRows[0].memory_count).toBe(3);
    expect(orgRows[0].ready_count).toBe(2);
    expect(orgRows[0].pending_count).toBe(1);

    // Idempotent: a second run replaces today's rows, not duplicates them.
    await snapshotCorpus();
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM fact_brain_corpus WHERE user_id = ${userId}
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(1);
  });

  it("getRecallStats: aggregates hit-rate + latency over the window (T18)", async () => {
    await recordRecall({ userId, organisationId: orgId, hitCount: 3, latencyMs: 20, recalledMemoryIds: [] });
    const s = await getRecallStats(30);
    expect(s.totalRecalls).toBeGreaterThanOrEqual(1);
    expect(s.hitRate).toBeGreaterThan(0); // at least our hits>0 recall counts
    expect(s.avgLatencyMs).toBeGreaterThan(0);
    expect(s.daily.length).toBeGreaterThanOrEqual(1);
  });

  it("getCorpusStats: live scope/status breakdown (T16/T17 density signal)", async () => {
    const c = await getCorpusStats();
    expect(c.totalMemories).toBeGreaterThanOrEqual(5); // our 2 user + 3 org
    expect(c.byScope.user).toBeGreaterThanOrEqual(2);
    expect(c.byScope.org).toBeGreaterThanOrEqual(3);
    expect(c.byStatus.ready).toBeGreaterThanOrEqual(1);
  });

  it("reembedFailedMemories: resets failed → pending for the worker (T18)", async () => {
    const [f] = (await db.execute(sql`
      INSERT INTO brain_memory (user_id, scope, source_type, body, status, attempt_count)
      VALUES (${userId}, 'user', 'chat', 'failed one', 'failed', 3)
      RETURNING memory_id
    `)) as unknown as Array<{ memory_id: string }>;
    const requeued = await reembedFailedMemories();
    expect(requeued).toBeGreaterThanOrEqual(1);
    const [row] = (await db.execute(sql`
      SELECT status, attempt_count FROM brain_memory WHERE memory_id = ${f.memory_id}
    `)) as unknown as Array<{ status: string; attempt_count: number }>;
    expect(row.status).toBe("pending");
    expect(row.attempt_count).toBe(0);
  });
});
