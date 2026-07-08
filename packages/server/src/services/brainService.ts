/**
 * @module brainService
 *
 * Public management API for the Brain (docs/specs/brain-memory.md, T8/T9) —
 * the service behind the "Your Brain" page and the admin observability
 * endpoint. Capture goes through `brainCaptureService.recordMemory` and
 * recall through `brainRecallService`; this module owns everything a user
 * (or admin) does TO the memory store: list, delete, stats.
 *
 * Tenant safety: every user-facing operation is scoped by `user_id` in the
 * WHERE clause — a memory id from another user is indistinguishable from a
 * missing one (no IDOR oracle).
 */

import { and, eq, desc, ilike, or, inArray, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { brainMemory, userOrganisation } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { getCaptureCounters } from "./brainCaptureService.js";
import { getUserOrgContext } from "./orgContextService.js";
import { sanitizeMemoryText } from "./brainSanitize.js";
import { resolveActiveOrg } from "./activeOrgService.js";

/** One row in the "Your Brain" list. Bodies are the user's own data. */
export interface BrainMemoryListItem {
  memoryId: string;
  title: string | null;
  body: string;
  sourceType: string;
  scope: string;
  /** Pinned memories sort first (spec T14b). */
  isPinned: boolean;
  /** 'pending' | 'processing' → "learning…" chip; 'ready' | 'failed'. */
  status: string;
  createdDttm: Date;
}

/** Options for {@link listMemories}. */
export interface ListMemoriesOptions {
  /** Filter to one source type (e.g. 'chat'). */
  sourceType?: string;
  /** Restrict to one visibility tier: 'user' (private) or 'org' (shared). */
  scope?: "user" | "org";
  /** Case-insensitive substring search over title + body. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * List the memories a user may see, newest first: their own private rows plus
 * the shared (`scope='org'`) rows of every org they belong to (spec T11). An
 * optional `scope` filter narrows to one tier. Optional source-type filter and
 * search apply within that tenant boundary. Includes pending/processing rows so
 * the UI can show the "learning…" state (spec interaction-states table).
 *
 * The org membership is read live per call, so a removed member immediately
 * stops seeing that org's shared rows (no stale-membership leak).
 */
export async function listMemories(
  userId: number,
  options: ListMemoriesOptions = {},
): Promise<{ memories: BrainMemoryListItem[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  // Tenant boundary: own private rows OR shared rows of a live-member org.
  const { orgIds } = await getUserOrgContext(userId);
  const tenant =
    orgIds.length > 0
      ? or(
          eq(brainMemory.userId, userId),
          and(inArray(brainMemory.organisationId, orgIds), eq(brainMemory.scope, "org")),
        )!
      : eq(brainMemory.userId, userId);

  const conditions = [tenant];
  if (options.scope) {
    conditions.push(eq(brainMemory.scope, options.scope));
  }
  if (options.sourceType) {
    conditions.push(eq(brainMemory.sourceType, options.sourceType));
  }
  if (options.search) {
    const pattern = `%${options.search}%`;
    conditions.push(
      or(ilike(brainMemory.title, pattern), ilike(brainMemory.body, pattern))!,
    );
  }
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        memoryId: brainMemory.memoryId,
        title: brainMemory.title,
        body: brainMemory.body,
        sourceType: brainMemory.sourceType,
        scope: brainMemory.scope,
        isPinned: brainMemory.isPinned,
        status: brainMemory.status,
        createdDttm: brainMemory.createdDttm,
      })
      .from(brainMemory)
      .where(where)
      // Pinned first (spec T14b), then newest.
      .orderBy(desc(brainMemory.isPinned), desc(brainMemory.createdDttm))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(brainMemory).where(where),
  ]);

  return { memories: rows, total: Number(total) };
}

/** The row fields needed to authorise a manage action. */
interface ManageableRow {
  scope: string;
  ownerUserId: number;
  organisationId: number | null;
}

/** Fetch just the fields needed to authorise a manage action, or null. */
async function fetchManageableRow(memoryId: string): Promise<ManageableRow | null> {
  const [row] = await db
    .select({
      scope: brainMemory.scope,
      ownerUserId: brainMemory.userId,
      organisationId: brainMemory.organisationId,
    })
    .from(brainMemory)
    .where(eq(brainMemory.memoryId, memoryId))
    .limit(1);
  return row ?? null;
}

/**
 * Single source of truth for "can this caller manage this memory?" (spec T11/T14b):
 *   - `scope='user'` → only the owner.
 *   - `scope='org'`  → only a live admin of the OWNING org (being an admin of
 *     some other org must not grant access).
 */
async function canManage(userId: number, row: ManageableRow): Promise<boolean> {
  if (row.scope === "org") {
    if (row.organisationId == null) return false;
    const adminRows = await db
      .select({ userOrganisationId: userOrganisation.userOrganisationId })
      .from(userOrganisation)
      .where(
        and(
          eq(userOrganisation.userId, userId),
          eq(userOrganisation.organisationId, row.organisationId),
          eq(userOrganisation.role, "admin"),
        ),
      )
      .limit(1);
    return adminRows.length > 0;
  }
  return row.ownerUserId === userId;
}

/**
 * Delete a memory the caller is authorised to remove (spec T11 / E5). Returns
 * false for a missing id or an unauthorised caller — indistinguishable outcomes
 * (no cross-tenant oracle; the controller maps false → 404).
 */
export async function deleteMemory(userId: number, memoryId: string): Promise<boolean> {
  const row = await fetchManageableRow(memoryId);
  if (!row || !(await canManage(userId, row))) return false;

  const deleted = await db
    .delete(brainMemory)
    .where(eq(brainMemory.memoryId, memoryId))
    .returning({ memoryId: brainMemory.memoryId });
  return deleted.length > 0;
}

/**
 * Pin / unpin a memory (spec T14b) — pinned rows sort first in "Your Brain".
 * Body unchanged, so no re-embed. Same authorisation as delete. Returns false
 * (→ 404) on a missing id or unauthorised caller.
 */
export async function pinMemory(userId: number, memoryId: string, pinned: boolean): Promise<boolean> {
  const row = await fetchManageableRow(memoryId);
  if (!row || !(await canManage(userId, row))) return false;

  await db
    .update(brainMemory)
    .set({ isPinned: pinned, updatedDttm: new Date() })
    .where(eq(brainMemory.memoryId, memoryId));
  return true;
}

/**
 * Correct a memory's text (spec T14b). The body changed, so the stale embedding
 * is cleared and the row re-enters the worker queue — exactly the reset
 * `recordMemory`'s upsert performs. Returns false (→ 404) on a missing id,
 * unauthorised caller, or empty-after-sanitise body.
 */
export async function correctMemory(userId: number, memoryId: string, newBody: string): Promise<boolean> {
  const row = await fetchManageableRow(memoryId);
  if (!row || !(await canManage(userId, row))) return false;

  const body = sanitizeMemoryText(newBody);
  if (!body) return false;

  await db
    .update(brainMemory)
    .set({
      body,
      // Content changed → previous embedding is stale; re-enter the queue.
      embedding: null,
      status: "pending",
      attemptCount: 0,
      nextAttemptDttm: null,
      updatedDttm: new Date(),
    })
    .where(eq(brainMemory.memoryId, memoryId));
  return true;
}

/**
 * Toggle a memory's scope (spec T14b):
 *   - private → shared: the owner promotes it to their ACTIVE org
 *     (`resolveActiveOrg`); fails if they have no org to share into.
 *   - shared → private: an admin of the owning org un-shares it.
 * Body is unchanged either way, so no re-embed. Idempotent if already in the
 * target scope. Returns false (→ 404) on a missing id or unauthorised caller.
 */
export async function toggleScope(
  userId: number,
  memoryId: string,
  targetScope: "user" | "org",
): Promise<boolean> {
  const row = await fetchManageableRow(memoryId);
  if (!row || !(await canManage(userId, row))) return false;
  if (row.scope === targetScope) return true; // already there — idempotent

  if (targetScope === "org") {
    // private → shared: share into the user's active org.
    const orgId = await resolveActiveOrg(userId);
    if (orgId == null) return false; // no org to share into
    await db
      .update(brainMemory)
      .set({ scope: "org", organisationId: orgId, updatedDttm: new Date() })
      .where(eq(brainMemory.memoryId, memoryId));
  } else {
    // shared → private: un-share (canManage already required org-admin here).
    await db
      .update(brainMemory)
      .set({ scope: "user", organisationId: null, updatedDttm: new Date() })
      .where(eq(brainMemory.memoryId, memoryId));
  }
  return true;
}

/** Admin observability snapshot (spec T9). */
export interface BrainStats {
  flags: Record<string, string>;
  /** Row counts by status — 'pending'+'failed' is the worker queue depth. */
  statusCounts: Record<string, number>;
  memoriesLast24h: number;
  memoriesLast7d: number;
  /** In-process capture counters since boot (spec T9: a 100%-broken capture must be visible). */
  capture: { recorded: number; skipped: number; errors: number };
}

/**
 * Brain health snapshot for the admin endpoint (spec T9 — the Phase-1 exit
 * criterion pairs this with the `brain_capture_error` log alert): flags,
 * queue depth, memories/day, and the in-process capture counters.
 */
export async function getBrainStats(): Promise<BrainStats> {
  const settings = await getAllSettings();
  const flags = Object.fromEntries(
    Object.entries(settings).filter(([key]) => key.startsWith("brain_")),
  );

  const statusRows = (await db.execute(sql`
    SELECT status, count(*)::int AS status_count
    FROM brain_memory
    GROUP BY status
  `)) as unknown as Array<{ status: string; status_count: number }>;

  const volumeRows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE created_dttm > now() - interval '24 hours')::int AS last_24h,
      count(*) FILTER (WHERE created_dttm > now() - interval '7 days')::int AS last_7d
    FROM brain_memory
  `)) as unknown as Array<{ last_24h: number; last_7d: number }>;

  return {
    flags,
    statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.status_count)])),
    memoriesLast24h: Number(volumeRows[0]?.last_24h ?? 0),
    memoriesLast7d: Number(volumeRows[0]?.last_7d ?? 0),
    capture: getCaptureCounters(),
  };
}
