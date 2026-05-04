/**
 * @module services/feedbackService
 *
 * Persistence + async-email forwarding for the mobile in-app feedback
 * channel (`POST /api/mobile/feedback`).
 *
 * The HTTP path is intentionally minimal: it inserts into `ckm_feedback`
 * and returns 201 immediately. Resend delivery happens out-of-band via
 * {@link processPendingFeedbackEmails}, scheduled by the 5-min interval
 * wired up in `index.ts`. This split exists because:
 *
 *   1. A synchronous Resend call → 500-on-failure → user retries → duplicate
 *      DB row. Plan v3 had inline send; outside-voice review reversed it
 *      (per `needs-frontend.md` 2026-05-04 "Why async").
 *   2. Mobile increments its local count badge ONLY on 201, so async send
 *      doesn't change the user-visible flow.
 *
 * Privacy invariants enforced here:
 *   - `body` is human prose. Never scanned, parsed, LLM-ified, or indexed.
 *   - Email body is `text/plain` MIME — never HTML — to defang any
 *     `<script>` / HTML-injection in the user-submitted body.
 *   - `device_info` JSONB is closed-shape; the controller's `.strict()`
 *     zod schema is the gatekeeper. This service writes whatever it
 *     receives without inspecting individual keys.
 *   - Anon submissions: `user_id` IS NULL and the row contains no IP.
 *     The optional rate-limit-side IP hash never reaches this layer.
 */

import { eq, and, isNull, lt, sql } from "drizzle-orm";
import { Resend } from "resend";
import pino from "pino";
import { db } from "../db/index.js";
import { ckmFeedback } from "../db/schema.js";
import { RESEND_FEEDBACK_INBOX } from "../utils/env.js";

const logger = pino({ name: "feedbackService" });

/** Closed-shape device info — must match the controller's zod schema. */
export interface FeedbackDeviceInfo {
  device_model: string;
  os_name: "ios" | "android";
  os_version: string;
  /** BCP 47, e.g. "en-US" */
  locale: string;
  /** Duplicates the X-Mobile-App-Version header value. */
  app_version: string;
}

export type FeedbackCategory = "bug" | "feature" | "feedback";

export interface SaveFeedbackInput {
  userId: number | null;
  isAnonymous: boolean;
  category: FeedbackCategory;
  subject: string;
  body: string;
  /** Source of truth: the X-Mobile-App-Version header, attached by the version-guard middleware. */
  appVersion: string;
  deviceInfo: FeedbackDeviceInfo | null;
  screenshotBase64: string | null;
}

export interface SavedFeedback {
  id: number;
  createdDttm: string;
}

/** Persist a feedback row. Returns the new row's id and ISO-formatted createdDttm. */
export async function saveFeedback(input: SaveFeedbackInput): Promise<SavedFeedback> {
  const [row] = await db
    .insert(ckmFeedback)
    .values({
      userId: input.userId,
      anonymousInd: input.isAnonymous,
      category: input.category,
      subject: input.subject,
      body: input.body,
      appVersion: input.appVersion,
      deviceInfo: input.deviceInfo ?? null,
      screenshotBase64: input.screenshotBase64,
    })
    .returning({
      feedbackId: ckmFeedback.feedbackId,
      createdDttm: ckmFeedback.createdDttm,
    });

  if (!row) {
    throw new Error("Feedback insert returned no row");
  }

  return {
    id: row.feedbackId,
    createdDttm: row.createdDttm.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Async email forwarding (5-min retry interval; see index.ts)
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
/** Base backoff in ms; actual wait is BACKOFF_MS * 2^attempts. */
const BACKOFF_MS = 15 * 60 * 1000; // 15 min

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@culinaire.kitchen";

/**
 * Asserts that the RESEND_FEEDBACK_INBOX is configured. Called from the
 * server boot path so a misconfigured deploy fails fast rather than
 * silently dropping feedback emails.
 *
 * Note: RESEND_FEEDBACK_INBOX has a default in env.ts so this currently
 * never throws — but if that default is removed the assertion stops the
 * server immediately.
 */
export function assertFeedbackEmailConfig(): void {
  if (!RESEND_FEEDBACK_INBOX) {
    throw new Error(
      "RESEND_FEEDBACK_INBOX is required for the mobile feedback retry job",
    );
  }
}

/**
 * Compose a plaintext email body for a feedback row. Plaintext is mandatory:
 * `body` is user-supplied prose and may contain `<script>` / HTML; sending
 * as text/plain defangs it without sanitisation gymnastics (per privacy
 * invariant in `needs-frontend.md`).
 */
function composePlaintextBody(row: {
  feedbackId: number;
  userId: number | null;
  anonymousInd: boolean;
  category: string;
  subject: string;
  body: string;
  appVersion: string;
  deviceInfo: unknown;
  createdDttm: Date;
}): string {
  const lines: string[] = [];
  lines.push(`Feedback ID: ${row.feedbackId}`);
  lines.push(`Category: ${row.category}`);
  lines.push(`User: ${row.anonymousInd ? "[ANON]" : `user_id=${row.userId ?? "?"}`}`);
  lines.push(`App version: ${row.appVersion}`);
  lines.push(`Submitted: ${row.createdDttm.toISOString()}`);
  if (row.deviceInfo && typeof row.deviceInfo === "object") {
    lines.push("");
    lines.push("Device:");
    for (const [k, v] of Object.entries(row.deviceInfo as Record<string, unknown>)) {
      lines.push(`  ${k}: ${String(v)}`);
    }
  }
  lines.push("");
  lines.push(`Subject: ${row.subject}`);
  lines.push("");
  lines.push("Body:");
  lines.push(row.body);
  return lines.join("\n");
}

function categoryPrefix(category: string, anon: boolean): string {
  const c = category[0]!.toUpperCase() + category.slice(1);
  const anonTag = anon ? "[ANON]" : "";
  return `[CK Mobile ${c}]${anonTag}`;
}

/**
 * Scan the `ckm_feedback` table for unsent rows still under the attempt
 * cap and try to forward each via Resend. Called every 5 minutes by the
 * boot interval. Idempotent — exits early if Resend isn't configured.
 *
 * Backoff: a row whose `email_send_attempts = n` is skipped until
 * `created_dttm + BACKOFF_MS * 2^n` has elapsed. Implemented in JS
 * (per-row check) rather than SQL because the volume is tiny — at v1.3
 * scale we expect <100 feedback rows / day.
 */
export async function processPendingFeedbackEmails(): Promise<{
  attempted: number;
  sent: number;
  failed: number;
}> {
  const client = getResend();
  if (!client) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const pending = await db
    .select()
    .from(ckmFeedback)
    .where(
      and(isNull(ckmFeedback.emailSentDttm), lt(ckmFeedback.emailSendAttempts, MAX_ATTEMPTS)),
    );

  let sent = 0;
  let failed = 0;
  const now = Date.now();

  for (const row of pending) {
    // Exponential backoff per row: skip if not yet due.
    const dueAt = row.createdDttm.getTime() + BACKOFF_MS * Math.pow(2, row.emailSendAttempts);
    if (row.emailSendAttempts > 0 && now < dueAt) continue;

    const subject = `${categoryPrefix(row.category, row.anonymousInd)} ${row.subject}`;
    const text = composePlaintextBody(row);

    const attachments: { filename: string; content: string }[] = [];
    if (row.screenshotBase64) {
      // Already base64 from the client (no `data:image/...` prefix per the
      // contract). Resend accepts a base64 `content` string directly.
      attachments.push({
        filename: `feedback-${row.feedbackId}-screenshot.png`,
        content: row.screenshotBase64,
      });
    }

    try {
      const { error } = await client.emails.send({
        from: FROM_EMAIL,
        to: RESEND_FEEDBACK_INBOX,
        subject,
        text, // plaintext only — never `html`
        ...(attachments.length > 0 ? { attachments } : {}),
      });

      if (error) {
        await db
          .update(ckmFeedback)
          .set({ emailSendAttempts: sql`${ckmFeedback.emailSendAttempts} + 1` })
          .where(eq(ckmFeedback.feedbackId, row.feedbackId));
        failed++;
        logger.warn(
          { feedbackId: row.feedbackId, attempts: row.emailSendAttempts + 1, err: error },
          "Resend rejected feedback email — will retry",
        );
      } else {
        await db
          .update(ckmFeedback)
          .set({ emailSentDttm: new Date() })
          .where(eq(ckmFeedback.feedbackId, row.feedbackId));
        sent++;
      }
    } catch (err) {
      await db
        .update(ckmFeedback)
        .set({ emailSendAttempts: sql`${ckmFeedback.emailSendAttempts} + 1` })
        .where(eq(ckmFeedback.feedbackId, row.feedbackId));
      failed++;
      logger.error(
        { feedbackId: row.feedbackId, attempts: row.emailSendAttempts + 1, err },
        "Feedback email send threw — will retry",
      );
    }
  }

  if (pending.length > 0) {
    logger.info(
      { attempted: pending.length, sent, failed },
      "Processed pending feedback emails",
    );
  }
  return { attempted: pending.length, sent, failed };
}
