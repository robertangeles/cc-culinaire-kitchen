/**
 * @module brainService
 *
 * Public management API for the Brain (docs/specs/brain-memory.md, T8/T9/T14c) —
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
import { brainMemory, userOrganisation, user } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { getCaptureCounters } from "./brainCaptureService.js";
import { getUserOrgContext } from "./orgContextService.js";
import { sanitizeMemoryText } from "./brainSanitize.js";
import { resolveActiveOrg } from "./activeOrgService.js";
import { decryptUserPii } from "./piiService.js";

/** A DB handle or an open transaction — mutations lock+authorise+write in one tx. */
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  /**
   * Whether the viewer may pin/correct/share/delete THIS row (spec T14c): true
   * for their own memory, or for a shared row when they're a live admin of the
   * owning org. The client hides row actions when false (the server enforces
   * the same rule — this is UX, not the boundary).
   */
  canManage: boolean;
  /**
   * Author label for shared rows (spec T14c): the decrypted author name, or
   * "Former team member" when the author has left the owning org. `null` for
   * private rows (they're the viewer's own — no attribution needed).
   */
  authorName: string | null;
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

/** A row as fetched for the list, before manage/author enrichment. */
interface RawListRow {
  memoryId: string;
  title: string | null;
  body: string;
  sourceType: string;
  scope: string;
  isPinned: boolean;
  status: string;
  createdDttm: Date;
  ownerUserId: number;
  organisationId: number | null;
}

/**
 * List the memories a user may see, newest first: their own private rows plus
 * the shared (`scope='org'`) rows of every org they belong to (spec T11). An
 * optional `scope` filter narrows to one tier. Optional source-type filter and
 * search apply within that tenant boundary. Includes pending/processing rows so
 * the UI can show the "learning…" state (spec interaction-states table).
 *
 * The org membership is read live per call, so a removed member immediately
 * stops seeing that org's shared rows (no stale-membership leak). Each row also
 * carries `canManage` + `authorName` for the org-admin surface (spec T14c).
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
        ownerUserId: brainMemory.userId,
        organisationId: brainMemory.organisationId,
      })
      .from(brainMemory)
      .where(where)
      // Pinned first (spec T14b), then newest.
      .orderBy(desc(brainMemory.isPinned), desc(brainMemory.createdDttm))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(brainMemory).where(where),
  ]);

  const memories = await enrichForViewer(userId, rows as RawListRow[]);
  return { memories, total: Number(total) };
}

/**
 * Attach `canManage` + `authorName` to each list row for the viewer (spec T14c).
 * All lookups are batched over the page — no per-row query:
 *   - one query for the viewer's admin org ids (manage authorisation on org rows);
 *   - one query for author PII (decrypted) + one for the authors' live memberships
 *     (to render "Former team member" when an author has left the owning org).
 */
async function enrichForViewer(
  viewerId: number,
  rows: RawListRow[],
): Promise<BrainMemoryListItem[]> {
  // Orgs the viewer is a live admin of — the manage grant for shared rows.
  const adminRows = await db
    .select({ organisationId: userOrganisation.organisationId })
    .from(userOrganisation)
    .where(and(eq(userOrganisation.userId, viewerId), eq(userOrganisation.role, "admin")));
  const adminOrgIds = new Set(adminRows.map((r) => r.organisationId));

  // Author attribution is only shown on shared rows.
  const orgRows = rows.filter((r) => r.scope === "org" && r.organisationId != null);
  const authorNameById = new Map<number, string>();
  const liveAuthorOrg = new Set<string>(); // `${authorId}:${orgId}` for live memberships

  if (orgRows.length > 0) {
    const authorIds = [...new Set(orgRows.map((r) => r.ownerUserId))];
    const orgIdSet = [...new Set(orgRows.map((r) => r.organisationId!))];
    const [authorRows, memberRows] = await Promise.all([
      db
        .select({
          userId: user.userId,
          userName: user.userName,
          userNameEnc: user.userNameEnc,
          userNameIv: user.userNameIv,
          userNameTag: user.userNameTag,
        })
        .from(user)
        .where(inArray(user.userId, authorIds)),
      db
        .select({ userId: userOrganisation.userId, organisationId: userOrganisation.organisationId })
        .from(userOrganisation)
        .where(
          and(
            inArray(userOrganisation.userId, authorIds),
            inArray(userOrganisation.organisationId, orgIdSet),
          ),
        ),
    ]);
    for (const a of authorRows) {
      // Real name lives in the encrypted columns; the plaintext column is a
      // fallback that may be empty post-migration (see wasteDigestService).
      const pii = decryptUserPii(a as unknown as Record<string, unknown>);
      authorNameById.set(a.userId, pii.userName);
    }
    for (const m of memberRows) liveAuthorOrg.add(`${m.userId}:${m.organisationId}`);
  }

  return rows.map((r) => ({
    memoryId: r.memoryId,
    title: r.title,
    body: r.body,
    sourceType: r.sourceType,
    scope: r.scope,
    isPinned: r.isPinned,
    status: r.status,
    createdDttm: r.createdDttm,
    canManage:
      r.scope === "org"
        ? r.organisationId != null && adminOrgIds.has(r.organisationId)
        : r.ownerUserId === viewerId,
    authorName:
      r.scope === "org"
        ? liveAuthorOrg.has(`${r.ownerUserId}:${r.organisationId}`)
          ? authorNameById.get(r.ownerUserId) ?? null
          : "Former team member"
        : null,
  }));
}

/** The row fields needed to authorise a manage action. */
interface ManageableRow {
  scope: string;
  ownerUserId: number;
  organisationId: number | null;
}

/**
 * Lock and read just the fields needed to authorise a manage action, inside the
 * caller's transaction (`FOR UPDATE`). Locking the row here closes the TOCTOU
 * race where the owner un-shares (scope→user) between the authorisation check
 * and the mutation (spec T14c): the row can't change scope until this tx ends.
 */
async function lockManageableRow(
  tx: Executor,
  memoryId: string,
): Promise<ManageableRow | null> {
  const [row] = await tx
    .select({
      scope: brainMemory.scope,
      ownerUserId: brainMemory.userId,
      organisationId: brainMemory.organisationId,
    })
    .from(brainMemory)
    .where(eq(brainMemory.memoryId, memoryId))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Single source of truth for "can this caller manage this memory?" (spec T11/T14b):
 *   - `scope='user'` → only the owner.
 *   - `scope='org'`  → only a live admin of the OWNING org (being an admin of
 *     some other org must not grant access).
 * Runs inside the caller's transaction so the membership read is consistent
 * with the locked row.
 */
async function canManage(userId: number, row: ManageableRow, tx: Executor): Promise<boolean> {
  if (row.scope === "org") {
    if (row.organisationId == null) return false;
    const adminRows = await tx
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
 * Delete a memory the caller is authorised to remove (spec T11 / E5 / T14c).
 * The lock→authorise→delete run in one transaction so a concurrent scope change
 * can't slip between the check and the delete. Returns false for a missing id or
 * an unauthorised caller — indistinguishable outcomes (no cross-tenant oracle;
 * the controller maps false → 404).
 */
export async function deleteMemory(userId: number, memoryId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await lockManageableRow(tx, memoryId);
    if (!row || !(await canManage(userId, row, tx))) return false;

    const deleted = await tx
      .delete(brainMemory)
      .where(eq(brainMemory.memoryId, memoryId))
      .returning({ memoryId: brainMemory.memoryId });
    return deleted.length > 0;
  });
}

/**
 * Pin / unpin a memory (spec T14b) — pinned rows sort first in "Your Brain".
 * Body unchanged, so no re-embed. Same authorisation as delete, same locked
 * transaction (spec T14c). Returns false (→ 404) on a missing id or unauthorised
 * caller.
 */
export async function pinMemory(userId: number, memoryId: string, pinned: boolean): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await lockManageableRow(tx, memoryId);
    if (!row || !(await canManage(userId, row, tx))) return false;

    await tx
      .update(brainMemory)
      .set({ isPinned: pinned, updatedDttm: new Date() })
      .where(eq(brainMemory.memoryId, memoryId));
    return true;
  });
}

/**
 * Correct a memory's text (spec T14b). The body changed, so the stale embedding
 * is cleared and the row re-enters the worker queue — exactly the reset
 * `recordMemory`'s upsert performs. Lock→authorise→update in one transaction
 * (spec T14c). Returns false (→ 404) on a missing id, unauthorised caller, or
 * empty-after-sanitise body.
 */
export async function correctMemory(userId: number, memoryId: string, newBody: string): Promise<boolean> {
  const body = sanitizeMemoryText(newBody);
  if (!body) return false;

  return db.transaction(async (tx) => {
    const row = await lockManageableRow(tx, memoryId);
    if (!row || !(await canManage(userId, row, tx))) return false;

    await tx
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
  });
}

/**
 * Toggle a memory's scope (spec T14b):
 *   - private → shared: the owner promotes it to their ACTIVE org
 *     (`resolveActiveOrg`); fails if they have no org to share into.
 *   - shared → private: an admin of the owning org un-shares it.
 * Body is unchanged either way, so no re-embed. Lock→authorise→update in one
 * transaction (spec T14c). Idempotent if already in the target scope. Returns
 * false (→ 404) on a missing id or unauthorised caller.
 */
export async function toggleScope(
  userId: number,
  memoryId: string,
  targetScope: "user" | "org",
): Promise<boolean> {
  // Resolve the target org OUTSIDE the row lock (it reads the caller's own
  // membership, not the locked row) so the lock is held only around the write.
  const shareOrgId = targetScope === "org" ? await resolveActiveOrg(userId) : null;
  if (targetScope === "org" && shareOrgId == null) return false; // no org to share into

  return db.transaction(async (tx) => {
    const row = await lockManageableRow(tx, memoryId);
    if (!row || !(await canManage(userId, row, tx))) return false;
    if (row.scope === targetScope) return true; // already there — idempotent

    if (targetScope === "org") {
      // `resolveActiveOrg` ran before the tx opened, so re-verify the caller is
      // STILL a live member of the share target inside the lock (lesson #59:
      // re-authorise the tenant on the write path). Closes the narrow window
      // where the caller is removed from the org between resolve and write.
      const stillMember = await tx
        .select({ id: userOrganisation.userOrganisationId })
        .from(userOrganisation)
        .where(
          and(
            eq(userOrganisation.userId, userId),
            eq(userOrganisation.organisationId, shareOrgId!),
          ),
        )
        .limit(1);
      if (stillMember.length === 0) return false;

      await tx
        .update(brainMemory)
        .set({ scope: "org", organisationId: shareOrgId, updatedDttm: new Date() })
        .where(eq(brainMemory.memoryId, memoryId));
    } else {
      // shared → private: un-share (canManage already required org-admin here).
      await tx
        .update(brainMemory)
        .set({ scope: "user", organisationId: null, updatedDttm: new Date() })
        .where(eq(brainMemory.memoryId, memoryId));
    }
    return true;
  });
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
