/**
 * @module services/brainCompactionService
 *
 * Memory compaction (Phase 3 T16) — keeps recall's exact-scan fast by folding a
 * tenant's coldest, least-recently-recalled memories into a single summarised
 * `memory_kind='digest'` row once they exceed a per-scope cap.
 *
 * Disposal is SOFT-ARCHIVE, never delete (locked decision): the merged sources
 * get `status='archived'` — recall already filters `status='ready'`, so they
 * drop out of the scan immediately while staying auditable and reversible. A
 * hard purge of archived rows is a separate, later opt-in.
 *
 *   over-cap group ──▶ pick coldest (n - cap) ──▶ summarizeMemories() ──▶ digest
 *        │                (last_recalled NULLS FIRST, then oldest)          │
 *        └── in one tx: INSERT digest (status='pending' → embeds) ──────────┤
 *                       UPDATE sources SET status='archived' ◀──────────────┘
 *
 * Fail-CLOSED: if the summariser returns null, the batch is skipped — sources
 * are NEVER archived without a digest to replace them. Off by default:
 * `brain_compaction_enabled` must be true AND `brain_compaction_cap` > 0.
 * Runs nightly under `withAdvisoryLock` so only one instance compacts.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { brainMemory } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { summarizeMemories } from "./brainDistillService.js";

const logger = pino({ name: "brainCompaction" });

/** Cap the groups compacted per run so a night's LLM spend stays bounded. */
const MAX_GROUPS_PER_RUN = 50;
/** Need at least this many cold rows to be worth an LLM merge. */
const MIN_BATCH = 2;

export interface CompactionResult {
  groups: number;
  digests: number;
  archived: number;
}

/**
 * Compact every tenant+scope over the cap (nightly entry point). No-op unless
 * `brain_compaction_enabled` and a positive `brain_compaction_cap`.
 */
export async function compactAll(): Promise<CompactionResult> {
  const result: CompactionResult = { groups: 0, digests: 0, archived: 0 };

  const settings = await getAllSettings();
  if (settings.brain_enabled === "false" || settings.brain_compaction_enabled !== "true") {
    return result;
  }
  const cap = Number(settings.brain_compaction_cap);
  if (!Number.isFinite(cap) || cap <= 0) return result; // disabled

  // Over-cap groups: user-scope by user_id, org-scope by organisation_id. Only
  // 'ready' events count toward the cap (digests + archived rows are excluded).
  const groups = (await db.execute(sql`
    SELECT
      (CASE WHEN scope = 'user' THEN user_id ELSE organisation_id END) AS tenant_id,
      scope,
      count(*)::int AS n
    FROM brain_memory
    WHERE status = 'ready' AND memory_kind = 'event'
      AND (scope = 'user' OR (scope = 'org' AND organisation_id IS NOT NULL))
    GROUP BY 1, scope
    HAVING count(*) > ${cap}
    ORDER BY n DESC
    LIMIT ${MAX_GROUPS_PER_RUN}
  `)) as unknown as Array<{ tenant_id: number; scope: string; n: number }>;

  for (const g of groups) {
    const excess = g.n - cap;
    if (excess < MIN_BATCH) continue;
    await compactGroup(g.tenant_id, g.scope === "org" ? "org" : "user", excess, result);
  }

  if (result.groups > 0) logger.info(result, "brain.compaction.run");
  return result;
}

/** Fold one tenant+scope's `excess` coldest memories into a digest, soft-archiving them. */
async function compactGroup(
  tenantId: number,
  scope: "user" | "org",
  excess: number,
  result: CompactionResult,
): Promise<void> {
  const tenantWhere =
    scope === "user"
      ? and(eq(brainMemory.userId, tenantId), eq(brainMemory.scope, "user"))
      : and(eq(brainMemory.organisationId, tenantId), eq(brainMemory.scope, "org"));

  // Coldest = least-recently-recalled (never-recalled first), then oldest.
  const cold = await db
    .select({ memoryId: brainMemory.memoryId, userId: brainMemory.userId, body: brainMemory.body })
    .from(brainMemory)
    .where(and(tenantWhere, eq(brainMemory.status, "ready"), eq(brainMemory.memoryKind, "event")))
    .orderBy(sql`${brainMemory.lastRecalledDttm} ASC NULLS FIRST`, sql`${brainMemory.createdDttm} ASC`)
    .limit(excess);

  if (cold.length < MIN_BATCH) return;

  // Fail-CLOSED: no digest → skip. Never archive sources without a replacement.
  const digestBody = await summarizeMemories(cold.map((c) => c.body));
  if (!digestBody) return;

  const ids = cold.map((c) => c.memoryId);
  await db.transaction(async (tx) => {
    await tx.insert(brainMemory).values({
      // Org digests need an author (user_id NOT NULL) — use a real source author.
      userId: cold[0].userId,
      organisationId: scope === "org" ? tenantId : null,
      scope,
      memoryKind: "digest",
      sourceType: "digest",
      body: digestBody,
      status: "pending", // embed on the next worker tick → becomes recallable
    });
    await tx
      .update(brainMemory)
      .set({ status: "archived", updatedDttm: new Date() })
      .where(inArray(brainMemory.memoryId, ids));
  });

  result.groups += 1;
  result.digests += 1;
  result.archived += ids.length;
}
