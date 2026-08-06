/**
 * @module utils/dailyRunClaim
 *
 * Once-per-day run claim for scheduled jobs, backed by a single `site_setting`
 * row per job. One atomic statement does four jobs at once:
 *
 *   UPDATE site_setting SET setting_value = :today
 *    WHERE setting_key = :key AND setting_value <> :today
 *   RETURNING setting_id;
 *
 *   - cross-instance mutex   exactly one caller gets a row back
 *   - restart-safe day guard state lives in the DB, not a JS variable, so a
 *                            deploy inside the run window cannot re-fire the job
 *   - heartbeat              setting_value IS the last-run date an admin reads
 *   - no held connection     unlike wrapping the whole scan in withAdvisoryLock,
 *                            which holds one pool connection for the duration
 *
 * WHY NOT `withAdvisoryLock`: that helper runs `fn()` inside `db.transaction()`
 * but never passes `tx` to it — `fn: () => Promise<void>` takes no argument — so
 * every consumer writes through the module-level `db` on other pooled
 * connections anyway. The lock's only real cost is holding a connection idle for
 * the whole of `fn`, which its own doc comment warns about ("keep `fn` fast").
 * For a long scan that is a self-inflicted pool-exhaustion risk.
 *
 * WHY NOT `settingsService`: `upsertSettings()` is SELECT-then-write across two
 * round trips, so it cannot express "update only if the value differs" — the
 * atomicity is the entire point here. `getAllSettings()` also serves from a
 * module-scope cache, so these functions talk to `db` directly and never read
 * through it.
 *
 *   claim ──▶ won?  ──yes──▶ run the work ──▶ done (value stays = today)
 *              │                   │
 *              │                   └── threw ──▶ release() ──▶ retry next tick
 *              └──no──▶ someone else owns today, return
 */

import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSetting } from "../db/schema.js";

/** `site_setting` key prefix, so every job's heartbeat is greppable as one family. */
export const DAILY_RUN_KEY_PREFIX = "job_last_run:";

/** Build the namespaced setting key for a job. */
export function dailyRunKey(jobName: string): string {
  return `${DAILY_RUN_KEY_PREFIX}${jobName}`;
}

/**
 * Local calendar day as `YYYY-MM-DD`. Pure, and takes the clock as an argument
 * so tests inject it rather than depending on when they run.
 */
export function dayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Local calendar day AND hour as `YYYY-MM-DD-HH`, for jobs that may legitimately
 * run more than once a day (none today, but the weekly digests key on the hour).
 */
export function dayHourKey(now: Date): string {
  return `${dayKey(now)}-${String(now.getHours()).padStart(2, "0")}`;
}

/**
 * Ensure the row exists so the conditional UPDATE has something to match.
 * `""` is a safe seed: it can never equal a real day key, so the first claim
 * after seeding always wins. Idempotent — relies on the unique constraint on
 * `setting_key`.
 */
async function ensureRow(key: string): Promise<void> {
  await db
    .insert(siteSetting)
    .values({ settingKey: key, settingValue: "" })
    .onConflictDoNothing();
}

/**
 * Atomically claim `period` (a day key, or day-hour key) for `jobName`.
 *
 * @returns true if THIS caller owns the run. False means someone else already
 *          claimed it — return immediately and do no work.
 */
export async function claimDailyRun(jobName: string, period: string): Promise<boolean> {
  const key = dailyRunKey(jobName);
  await ensureRow(key);

  const rows = await db
    .update(siteSetting)
    .set({ settingValue: period, updatedDttm: new Date() })
    .where(and(eq(siteSetting.settingKey, key), ne(siteSetting.settingValue, period)))
    .returning({ settingId: siteSetting.settingId });

  return rows.length > 0;
}

/**
 * Give the claim back so the next tick can retry the same period.
 *
 * Call this when the work threw. Without it, a mid-run crash means no retry
 * until tomorrow — the claim is taken BEFORE the work, deliberately, so that
 * two instances cannot both start.
 */
export async function releaseDailyRun(jobName: string): Promise<void> {
  await db
    .update(siteSetting)
    .set({ settingValue: "", updatedDttm: new Date() })
    .where(eq(siteSetting.settingKey, dailyRunKey(jobName)));
}

/**
 * Last period this job completed a claim for, or null if it has never run.
 * This is the heartbeat `GET /api/compliance/stats` reads to prove the job is
 * alive — a stale value is the signal that a job died silently.
 */
export async function readLastRun(jobName: string): Promise<string | null> {
  const [row] = await db
    .select({ value: siteSetting.settingValue })
    .from(siteSetting)
    .where(eq(siteSetting.settingKey, dailyRunKey(jobName)));

  if (!row || row.value === "") return null;
  return row.value;
}

/** Minimal logger shape — matches pino, avoids importing it here. */
interface ClaimLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface RunIfClaimedOptions {
  /** Short job name; becomes `job_last_run:<job>` in `site_setting`. */
  job: string;
  /** Is this tick inside the job's window? Pure — takes the clock. */
  due: (now: Date) => boolean;
  /** Period key this run claims — `dayKey` for daily, `dayHourKey` for weekly. */
  period: (now: Date) => string;
  /** The actual work. */
  run: () => Promise<void>;
  log: ClaimLogger;
  /** Injectable clock, so tests do not depend on when they run. */
  now?: () => Date;
}

/**
 * Tick handler for a scheduled job: check the window, claim the period, run the
 * work, and give the claim back if the work threw.
 *
 * Ordering is deliberate. The claim is taken BEFORE the work so two instances
 * can never both start. That means a crash mid-run would otherwise block retries
 * until the next period, so the `catch` releases it.
 *
 * @returns true if this call actually ran the work.
 */
export async function runIfClaimed(opts: RunIfClaimedOptions): Promise<boolean> {
  const now = (opts.now ?? (() => new Date()))();
  if (!opts.due(now)) return false;

  let claimed = false;
  try {
    claimed = await claimDailyRun(opts.job, opts.period(now));
  } catch (err) {
    // A failed claim must not take the process down, and must not run the work.
    opts.log.error({ err, job: opts.job }, `Scheduled job claim failed: ${opts.job}`);
    return false;
  }
  if (!claimed) return false;

  try {
    await opts.run();
    return true;
  } catch (err) {
    opts.log.error({ err, job: opts.job }, `Scheduled job failed: ${opts.job}`);
    try {
      await releaseDailyRun(opts.job);
    } catch (releaseErr) {
      // Losing the release only costs a retry this period, never correctness.
      opts.log.error(
        { err: releaseErr, job: opts.job },
        `Scheduled job claim release failed: ${opts.job}`,
      );
    }
    return false;
  }
}
