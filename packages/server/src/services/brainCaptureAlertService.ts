/**
 * @module brainCaptureAlertService
 *
 * Steady-state safety net for Brain capture (docs/specs/brain-memory.md — the
 * T9 capture-error alert / Phase-1 exit criterion).
 *
 * `recordMemory` swallows its own errors by contract (capture must never break
 * chat), so a 100%-broken capture path looks perfectly healthy — no 500s, no
 * user-visible symptom. This service watches the in-process capture counters
 * ({@link getCaptureCounters}) and, when the error rate over a check window
 * says capture is genuinely broken, pushes an alert to platform Administrators
 * (in-app bell + Resend email). It is the push complement to the pull-based
 * health readout in the admin Settings → Brain tab.
 *
 * Runs as a `setInterval` in index.ts (same pattern as the waste-digest /
 * feedback-retry workers). Inert unless `brain_enabled` AND
 * `brain_capture_enabled` are on. Rate-limited to at most one alert per hour
 * (DB-backed, so it survives restarts).
 */

import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { user, userRole, role, userOrganisation, organisation } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { getCaptureCounters } from "./brainCaptureService.js";
import { createInApp, sendEmailNotification, hasRecentNotification } from "./notificationService.js";

const logger = pino({ name: "brainCaptureAlertService" });

/** Snapshot of the capture counters at the previous check. Null until the first tick. */
type Counters = { recorded: number; skipped: number; errors: number };
let prevSnapshot: Counters | null = null;

/** Minimum new errors in a window before we consider alerting (ignores 1-2 transient blips). */
const MIN_ERRORS = 3;

/** Rate-limit window: at most one capture alert per this many hours. */
const ALERT_WINDOW_HOURS = 1;

/** Stable identity for the rate-limit dedup (the alert is about the whole capture path, not an entity). */
const ALERT_ENTITY_TYPE = "brain";
const ALERT_ENTITY_ID = "capture-health";

/**
 * Pure trigger decision — exported for unit testing.
 *
 * Alerts when, since the last snapshot, errors both (a) cleared the noise floor
 * ({@link MIN_ERRORS}) and (b) dominated successes (errors ≥ recorded). That is
 * the signature of "capture is broken", not "one embed hiccup". A counter reset
 * (process restart → curr < prev) yields negative deltas and never fires; the
 * caller re-baselines the snapshot regardless.
 */
export function shouldAlertCaptureError(
  prev: Counters | null,
  curr: Counters,
  minErrors = MIN_ERRORS,
): boolean {
  if (!prev) return false;
  const errorsDelta = curr.errors - prev.errors;
  const recordedDelta = curr.recorded - prev.recorded;
  if (errorsDelta < minErrors) return false;
  return errorsDelta >= recordedDelta;
}

/**
 * One check tick. Gated on the capture flags; re-baselines the snapshot every
 * call; fires the alert (rate-limited) when the trigger says capture is broken.
 */
export async function checkCaptureHealth(): Promise<void> {
  try {
    const settings = await getAllSettings();
    if (settings.brain_enabled !== "true" || settings.brain_capture_enabled !== "true") {
      // Capture off — reset the baseline so re-enabling starts clean.
      prevSnapshot = null;
      return;
    }

    const curr = getCaptureCounters();
    const fire = shouldAlertCaptureError(prevSnapshot, curr);
    const prev = prevSnapshot;
    prevSnapshot = curr;

    if (!fire || !prev) return;

    // Rate-limit (DB-backed, survives restarts).
    if (await hasRecentNotification(ALERT_ENTITY_TYPE, ALERT_ENTITY_ID, "BRAIN_CAPTURE_ERROR", ALERT_WINDOW_HOURS)) {
      return;
    }

    const errorsDelta = curr.errors - prev.errors;
    const recordedDelta = curr.recorded - prev.recorded;
    await notifyAdmins(errorsDelta, recordedDelta);
  } catch (err) {
    // Never let the safety net take the process down.
    logger.error({ err }, "brain.capture_alert.check_failed");
  }
}

/** Notify every platform Administrator (in-app + email), once per rate-limit window. */
async function notifyAdmins(errorsDelta: number, recordedDelta: number): Promise<void> {
  const admins = await getAdministrators();
  if (admins.length === 0) {
    logger.warn("brain.capture_alert.no_admins — capture is erroring but no Administrator to notify");
    return;
  }

  const payload = { errorsDelta, recordedDelta, windowHours: ALERT_WINDOW_HOURS };
  const subject = "⚠️ CulinAIre Brain: chat memory capture is failing";
  const html = `
    <p>The Brain's chat-memory capture is erroring in production.</p>
    <p>In the last check window: <strong>${errorsDelta} errors</strong> vs
       <strong>${recordedDelta} successful</strong> captures.</p>
    <p>Because capture is best-effort (it never breaks chat), this failure is
       otherwise silent. Check <strong>Settings → Brain</strong> for the live
       health readout, and the server logs for <code>"alert":"brain_capture_error"</code>.</p>
    <p>To stop capture while you investigate, flip <strong>Capture</strong> off in Settings → Brain.</p>
  `;

  for (const admin of admins) {
    try {
      await createInApp({
        organisationId: admin.orgId,
        recipientUserId: admin.userId,
        type: "BRAIN_CAPTURE_ERROR",
        payload,
        relatedEntityType: ALERT_ENTITY_TYPE,
        relatedEntityId: ALERT_ENTITY_ID,
      });
      if (admin.userEmail) {
        await sendEmailNotification({
          organisationId: admin.orgId,
          recipientUserId: admin.userId,
          recipientEmail: admin.userEmail,
          type: "BRAIN_CAPTURE_ERROR",
          payload,
          relatedEntityType: ALERT_ENTITY_TYPE,
          relatedEntityId: ALERT_ENTITY_ID,
          subject,
          htmlBody: html,
        });
      }
    } catch (err) {
      logger.error({ err, userId: admin.userId }, "brain.capture_alert.notify_failed");
    }
  }

  logger.warn(
    { alert: "brain_capture_error", adminCount: admins.length, errorsDelta, recordedDelta },
    "brain.capture_alert.sent",
  );
}

/**
 * Platform Administrators + one org each (for the notification's required
 * org FK). Falls back to the lowest org id in the system when an admin belongs
 * to none, so the alert still reaches them.
 */
async function getAdministrators(): Promise<Array<{ userId: number; userEmail: string; orgId: number }>> {
  const [fallback] = await db
    .select({ orgId: sql<number>`min(${organisation.organisationId})` })
    .from(organisation);
  const fallbackOrg = fallback?.orgId ?? null;
  if (!fallbackOrg) return [];

  const rows = await db
    .select({
      userId: user.userId,
      userEmail: user.userEmail,
      orgId: sql<number | null>`min(${userOrganisation.organisationId})`,
    })
    .from(user)
    .innerJoin(userRole, eq(user.userId, userRole.userId))
    .innerJoin(role, eq(userRole.roleId, role.roleId))
    .leftJoin(userOrganisation, eq(user.userId, userOrganisation.userId))
    .where(and(eq(role.roleName, "Administrator"), eq(user.userStatus, "active")))
    .groupBy(user.userId, user.userEmail);

  return rows.map((r) => ({
    userId: r.userId,
    userEmail: r.userEmail,
    orgId: r.orgId ?? fallbackOrg,
  }));
}
