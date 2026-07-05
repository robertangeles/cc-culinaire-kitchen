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

import { and, eq, desc, ilike, or, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { brainMemory } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { getCaptureCounters } from "./brainCaptureService.js";

/** One row in the "Your Brain" list. Bodies are the user's own data. */
export interface BrainMemoryListItem {
  memoryId: string;
  title: string | null;
  body: string;
  sourceType: string;
  scope: string;
  /** 'pending' | 'processing' → "learning…" chip; 'ready' | 'failed'. */
  status: string;
  createdDttm: Date;
}

/** Options for {@link listMemories}. */
export interface ListMemoriesOptions {
  /** Filter to one source type (e.g. 'chat'). */
  sourceType?: string;
  /** Case-insensitive substring search over title + body. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * List a user's own memories, newest first, with optional source-type filter
 * and search. Includes pending/processing rows so the UI can show the
 * "learning…" state (spec interaction-states table).
 */
export async function listMemories(
  userId: number,
  options: ListMemoriesOptions = {},
): Promise<{ memories: BrainMemoryListItem[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions = [eq(brainMemory.userId, userId)];
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
        status: brainMemory.status,
        createdDttm: brainMemory.createdDttm,
      })
      .from(brainMemory)
      .where(where)
      .orderBy(desc(brainMemory.createdDttm))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(brainMemory).where(where),
  ]);

  return { memories: rows, total: Number(total) };
}

/**
 * Delete one of the user's own memories. Ownership is enforced in the WHERE
 * clause; returns false when the id doesn't exist OR belongs to someone else
 * (identical outcomes — no cross-tenant oracle).
 */
export async function deleteMemory(userId: number, memoryId: string): Promise<boolean> {
  const deleted = await db
    .delete(brainMemory)
    .where(and(eq(brainMemory.memoryId, memoryId), eq(brainMemory.userId, userId)))
    .returning({ memoryId: brainMemory.memoryId });
  return deleted.length > 0;
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
