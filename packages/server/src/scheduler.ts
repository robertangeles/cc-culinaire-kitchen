/**
 * @module scheduler
 *
 * All background jobs. Called once from index.ts after the HTTP server starts
 * listening. Returns a cleanup function that clears every interval — call it
 * in the graceful-shutdown handler before closing the server.
 *
 * Jobs are gated by `scheduledJobsEnabled`. See the inline comment for why
 * they default OFF outside production (short version: they race the
 * integration test suite when the dev DB is shared).
 */

import type { Logger } from "pino";
import { isProductionProcess } from "./utils/envShim.js";
import { getAllSettings } from "./services/settingsService.js";
import { cleanupStaleSessions } from "./services/guestService.js";
import { purgeArchivedRecipes } from "./services/recipePersistenceService.js";
import { processPendingFeedbackEmails } from "./services/feedbackService.js";
import { runBrainWorkerTick, BRAIN_WORKER_INTERVAL_MS } from "./services/brainWorker.js";
import { checkCaptureHealth } from "./services/brainCaptureAlertService.js";
import { sendOrgDigests } from "./services/brainDigestService.js";
import { sendWeeklyWasteDigests } from "./services/wasteDigestService.js";
import { snapshotCorpus } from "./services/brainAnalyticsService.js";
import { compactAll } from "./services/brainCompactionService.js";
import { runNudges } from "./services/brainNudgeService.js";
import { runIfClaimed, dayKey, dayHourKey } from "./utils/dailyRunClaim.js";
import { runExpiryScan } from "./services/complianceExpiryJob.js";
import { purgeExpiredRetention, pruneAccessLog } from "./services/complianceRetentionService.js";
import { runPublicHolidayGapCheck } from "./services/publicHolidayService.js";

/** Starts all background jobs and returns a cleanup function. */
export function startScheduler(log: Logger): () => void {
  /**
   * Scheduled background jobs — gated.
   *
   * These mutate shared state on a timer. In development the dev database is
   * a SHARED remote instance, so a running `pnpm dev` silently competes with
   * anything else using that database. Concretely: the brain worker ticks
   * every 15s, claims the `brain_memory` rows an integration test just
   * seeded, embeds them, and the test then asserts on a queue that is already
   * empty. That produced a ~40% intermittent failure rate across
   * brainIntegration.test.ts — a different test each time, always green when
   * the file ran alone — which read as "flaky tests" for weeks. Nothing was
   * flaky: a live writer was racing the suite.
   *
   * Default ON in production, OFF everywhere else. `isProductionProcess()` is
   * the same predicate `assertSafeDbHost` uses as its hard rail, and
   * production must satisfy it to connect to its own database at all — so
   * this cannot silently disable prod jobs. Set ENABLE_SCHEDULED_JOBS=1 to
   * run them locally (e.g. to dogfood digests), knowing it will race tests.
   */
  const scheduledJobsEnabled = (() => {
    const raw = (process.env.ENABLE_SCHEDULED_JOBS ?? "").toLowerCase();
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
    return isProductionProcess();
  })();

  type Timer = ReturnType<typeof setInterval> | undefined;
  const everyMs = (fn: () => void, ms: number): Timer =>
    scheduledJobsEnabled ? setInterval(fn, ms) : undefined;
  const afterMs = (fn: () => void, ms: number): void => {
    if (scheduledJobsEnabled) setTimeout(fn, ms);
  };
  const runNow = (fn: () => void): void => {
    if (scheduledJobsEnabled) fn();
  };

  if (!scheduledJobsEnabled) {
    log.warn(
      "Scheduled background jobs are DISABLED (non-production default). They mutate " +
        "shared state on a timer and race anything else using this database, including " +
        "the integration test suite. Set ENABLE_SCHEDULED_JOBS=1 to run them here.",
    );
  }

  // Periodic guest session cleanup (runs once on start, then every hour)
  async function runGuestCleanup() {
    try {
      const settings = await getAllSettings();
      const idleHours = parseInt(settings.guest_session_idle_hours ?? "24", 10);
      if (idleHours > 0) await cleanupStaleSessions(idleHours);
    } catch (err) {
      log.error(err, "Guest session cleanup failed");
    }
  }
  runNow(runGuestCleanup);
  const cleanupInterval = everyMs(runGuestCleanup, 60 * 60 * 1000);

  // Periodic archived recipe purge (runs once on start, then every hour)
  async function runRecipePurge() {
    try {
      const settings = await getAllSettings();
      const days = parseInt(settings.recipe_archive_retention_days ?? "30", 10);
      if (days > 0) await purgeArchivedRecipes(days);
    } catch (err) {
      log.error(err, "Recipe archive purge failed");
    }
  }
  runNow(runRecipePurge);
  const purgeInterval = everyMs(runRecipePurge, 60 * 60 * 1000);

  // Mobile feedback email retry — every 5 min. Async by design (per
  // needs-frontend.md): the POST returns 201 the moment the row is
  // inserted; this loop forwards each row to the RESEND_FEEDBACK_INBOX
  // with exponential backoff (15 min × 2^attempts, capped at 5 tries).
  async function runFeedbackEmailRetry() {
    try {
      await processPendingFeedbackEmails();
    } catch (err) {
      log.error({ err }, "Feedback email retry job failed");
    }
  }
  // Defer the first run by 30 s so the server is fully warm before
  // we start hitting Resend.
  afterMs(runFeedbackEmailRetry, 30_000);
  const feedbackEmailInterval = everyMs(runFeedbackEmailRetry, 5 * 60 * 1000);

  // Brain embedding worker — claims pending brain_memory rows and embeds
  // them (SKIP LOCKED claim, attempt backoff). Inert while the
  // brain_enabled site setting is "false", so the flags-off rollback
  // leaves it doing nothing. Deferred 20 s so the server is warm first.
  async function runBrainWorker() {
    try {
      await runBrainWorkerTick();
    } catch (err) {
      log.error({ err }, "Brain worker tick failed");
    }
  }
  afterMs(runBrainWorker, 20_000);
  const brainWorkerInterval = everyMs(runBrainWorker, BRAIN_WORKER_INTERVAL_MS);

  // Brain capture-health alert — pushes an in-app + email alert to
  // Administrators when the capture error rate says capture is broken
  // (spec T9 exit criterion: a silently-failing capture must page). Inert
  // unless capture is enabled; rate-limited to one alert/hour. Checks
  // every 5 min.
  async function runCaptureHealthCheck() {
    try {
      await checkCaptureHealth();
    } catch (err) {
      log.error({ err }, "Brain capture-health check failed");
    }
  }
  const captureHealthInterval = everyMs(runCaptureHealthCheck, 5 * 60 * 1000);

  // Scheduled jobs below use `runIfClaimed` (utils/dailyRunClaim). It replaces
  // the old dual guard — an in-memory `last*Run` string plus withAdvisoryLock —
  // with ONE atomic conditional UPDATE on a `site_setting` row per job.
  //
  // Why the old shape was wrong on Render:
  //   - the in-memory key is a JS variable, so a deploy inside the run window
  //     resets it and the job re-fires (index.ts used to say so itself)
  //   - withAdvisoryLock never passes its `tx` to `fn`, so `fn`'s writes were
  //     never in that transaction anyway; the lock only held a pool connection
  //     open for the whole run
  //   - nothing recorded that a job had run, so a job dying silently was
  //     invisible until a customer noticed a missing digest
  //
  // The claim is the mutex, the restart-safe guard AND the heartbeat.
  const wasteDigestInterval = everyMs(() => void runIfClaimed({
    job: "waste_digest",
    due: (now) => now.getDay() === 0 && now.getHours() === 20,
    period: dayHourKey,
    run: sendWeeklyWasteDigests,
    log,
  }), 60_000);

  const brainDigestInterval = everyMs(() => void runIfClaimed({
    job: "brain_digest",
    due: (now) => now.getDay() === 0 && now.getHours() === 20,
    period: dayHourKey,
    run: sendOrgDigests,
    log,
  }), 60_000);

  const corpusSnapshotInterval = everyMs(() => void runIfClaimed({
    job: "brain_corpus_snapshot",
    due: (now) => now.getHours() === 3,
    period: dayKey,
    run: snapshotCorpus,
    log,
  }), 60_000);

  // Nightly Brain compaction — 03:30 daily (Phase 3 T16), after the snapshot.
  // No-op unless brain_compaction_enabled + a positive cap.
  const compactionInterval = everyMs(() => void runIfClaimed({
    job: "brain_compaction",
    due: (now) => now.getHours() === 3 && now.getMinutes() >= 30,
    period: dayKey,
    run: async () => { await compactAll(); },
    log,
  }), 60_000);

  // Daily Brain nudges — 09:00 (Phase 3 T17), a reasonable operator hour.
  // No-op unless brain_nudges_enabled; per-user opt-in + rate-limit inside.
  const nudgeInterval = everyMs(() => void runIfClaimed({
    job: "brain_nudge",
    due: (now) => now.getHours() === 9,
    period: dayKey,
    run: async () => { await runNudges(); },
    log,
  }), 60_000);

  // Daily compliance expiry scan — 06:00, so warnings land before service.
  // Minute-tick + hour gate rather than a 24h interval: Render restarts the
  // process on every deploy, which would reset a long timer and mean the
  // scan effectively never runs. The claim inside runIfClaimed is the mutex,
  // the restart-safe day guard AND the heartbeat GET /api/compliance/stats
  // reads to prove the job is alive.
  const complianceExpiryInterval = everyMs(() => void runIfClaimed({
    job: "compliance_expiry_scan",
    due: (now) => now.getHours() === 6,
    period: dayKey,
    run: async () => {
      const r = await runExpiryScan();
      log.info({ ...r }, "Compliance expiry scan complete");
    },
    log,
  }), 60_000);

  // Retention — 04:00 daily, before the venue opens. Purges documents whose
  // window has elapsed (destroying the Cloudinary object as well as the row,
  // or the blob is stranded where no policy reaches it) and prunes the
  // access log, which records PII access on every view and grows unbounded.
  const complianceRetentionInterval = everyMs(() => void runIfClaimed({
    job: "compliance_retention",
    due: (now) => now.getHours() === 4,
    period: dayKey,
    run: async () => {
      const purge = await purgeExpiredRetention();
      const pruned = await pruneAccessLog();
      log.info({ ...purge, accessLogPruned: pruned }, "Compliance retention complete");
    },
    log,
  }), 60_000);

  // Public holiday gap check — 05:00 daily. A heads-up, not enforcement:
  // the real block is publishRoster()'s own fail-loud check at the
  // moment a gap actually matters. This just surfaces one before anyone
  // hits it, via a structured alert marker an alerting pipeline can pick up.
  const publicHolidayGapCheckInterval = everyMs(() => void runIfClaimed({
    job: "public_holiday_gap_check",
    due: (now) => now.getHours() === 5,
    period: dayKey,
    run: async () => {
      const result = await runPublicHolidayGapCheck();
      if (result.missing.length > 0) {
        log.warn(
          { alert: "compliance_holiday_calendar_gap", missing: result.missing },
          "Public holiday calendar gap detected",
        );
      } else {
        log.info({ checked: result.checked }, "Public holiday gap check complete — no gaps");
      }
    },
    log,
  }), 60_000);

  return function clearAll() {
    clearInterval(cleanupInterval);
    clearInterval(purgeInterval);
    clearInterval(feedbackEmailInterval);
    clearInterval(brainWorkerInterval);
    clearInterval(captureHealthInterval);
    clearInterval(wasteDigestInterval);
    clearInterval(brainDigestInterval);
    clearInterval(corpusSnapshotInterval);
    clearInterval(compactionInterval);
    clearInterval(nudgeInterval);
    clearInterval(complianceExpiryInterval);
    clearInterval(complianceRetentionInterval);
    clearInterval(publicHolidayGapCheckInterval);
  };
}
