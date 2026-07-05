/**
 * @module brainWorker
 *
 * Async embedding worker for the Brain (docs/specs/brain-memory.md, T4).
 *
 * Runs as a `setInterval` job in `index.ts` (same pattern as the guest
 * cleanup / recipe purge / feedback retry workers). Each tick:
 *
 *   1. CLAIMS a batch of due rows with a single
 *      `UPDATE … WHERE memory_id IN (SELECT … FOR UPDATE SKIP LOCKED)` —
 *      safe under overlapping ticks and multiple server instances.
 *   2. Embeds each claimed body via the existing `embedText()` (which
 *      returns null on failure and never throws).
 *   3. On success → `status = 'ready'` (recallable).
 *      On failure → `attempt_count + 1`; terminal `'failed'` at 3 attempts
 *      (spec chaos criterion: a poisoned row stops cycling), otherwise back
 *      to `'pending'` with `next_attempt_dttm = now() + backoff` so there is
 *      no hot-loop.
 *
 * Stale-claim recovery: a row stuck in `'processing'` for 10+ minutes means
 * a previous process died mid-embed; it is reclaimed like a pending row.
 *
 * Note on the claim predicate: the spec's state machine makes `'failed'`
 * TERMINAL ("poisoned row stops at 3 attempts" is an exit criterion), so the
 * claim deliberately selects `'pending'` only. `'failed'` rows re-enter the
 * queue solely via the admin "re-embed failed" action (Phase 3), which
 * resets them to `'pending'`.
 *
 * Privacy: bodies are never logged — ids + outcome only.
 */

import { sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { embedText } from "./knowledgeService.js";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "brainWorker" });

/** Tick cadence for the index.ts interval — snappy enough that a chat turn is recallable within ~30 s. */
export const BRAIN_WORKER_INTERVAL_MS = 15_000;

/** Max rows claimed per tick — caps embed-API and pool pressure so the worker never starves requests. */
const CLAIM_BATCH_SIZE = 10;

/** Attempt count at which a row becomes terminally 'failed'. */
const MAX_ATTEMPTS = 3;

/** Exponential backoff after a failed attempt: 2 min, then 4 min. */
function backoffMs(attemptCount: number): number {
  return 60_000 * 2 ** attemptCount;
}

/** Row shape returned by the claim statement. */
interface ClaimedRow {
  memory_id: string;
  body: string;
  attempt_count: number;
}

/** Per-tick outcome, returned for tests and logged for observability (T9). */
export interface BrainWorkerTickResult {
  claimed: number;
  ready: number;
  failed: number;
}

/**
 * Run one worker tick: claim due rows, embed, transition states.
 *
 * Gated on `brain_enabled` so the flags-off rollback leaves the worker
 * fully inert. Individual row failures never abort the batch.
 */
export async function runBrainWorkerTick(): Promise<BrainWorkerTickResult> {
  const result: BrainWorkerTickResult = { claimed: 0, ready: 0, failed: 0 };

  const settings = await getAllSettings();
  if (settings.brain_enabled !== "true") return result;

  // CLAIM (spec): one statement — concurrent ticks/instances skip locked rows.
  const rows = (await db.execute(sql`
    UPDATE brain_memory
    SET status = 'processing', updated_dttm = now()
    WHERE memory_id IN (
      SELECT memory_id FROM brain_memory
      WHERE (
              status = 'pending'
              AND (next_attempt_dttm IS NULL OR next_attempt_dttm <= now())
            )
         OR (
              -- Stale-claim recovery: reclaim rows orphaned by a dead process.
              status = 'processing'
              AND updated_dttm < now() - interval '10 minutes'
            )
      ORDER BY created_dttm
      LIMIT ${CLAIM_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING memory_id, body, attempt_count
  `)) as unknown as ClaimedRow[];

  result.claimed = rows.length;
  if (rows.length === 0) return result;

  for (const row of rows) {
    try {
      // embedText returns null on any embedding failure (never throws).
      const embedding = await embedText(row.body);

      if (embedding) {
        await db.execute(sql`
          UPDATE brain_memory
          SET embedding = ${`[${embedding.join(",")}]`}::vector,
              status = 'ready',
              updated_dttm = now()
          WHERE memory_id = ${row.memory_id}
        `);
        result.ready++;
      } else {
        await failAttempt(row);
        result.failed++;
      }
    } catch (err) {
      // Unexpected error on this row (e.g. transient DB failure mid-update):
      // apply the same failure path best-effort and keep the batch moving.
      logger.error({ err, memoryId: row.memory_id }, "brain.worker.row_error");
      try {
        await failAttempt(row);
        result.failed++;
      } catch (inner) {
        logger.error({ err: inner, memoryId: row.memory_id }, "brain.worker.fail_path_error");
      }
    }
  }

  logger.info(
    { claimed: result.claimed, ready: result.ready, failed: result.failed },
    "brain.worker.tick",
  );
  return result;
}

/**
 * Failure transition for one claimed row: bump `attempt_count`; terminal
 * `'failed'` at {@link MAX_ATTEMPTS} (never claimed again), otherwise back to
 * `'pending'` with a real backoff window.
 */
async function failAttempt(row: ClaimedRow): Promise<void> {
  const attempts = row.attempt_count + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.execute(sql`
      UPDATE brain_memory
      SET status = 'failed',
          attempt_count = ${attempts},
          next_attempt_dttm = NULL,
          updated_dttm = now()
      WHERE memory_id = ${row.memory_id}
    `);
    logger.warn({ memoryId: row.memory_id, attempts }, "brain.worker.terminal_failure");
  } else {
    const nextAttempt = new Date(Date.now() + backoffMs(attempts));
    await db.execute(sql`
      UPDATE brain_memory
      SET status = 'pending',
          attempt_count = ${attempts},
          next_attempt_dttm = ${nextAttempt.toISOString()},
          updated_dttm = now()
      WHERE memory_id = ${row.memory_id}
    `);
  }
}
