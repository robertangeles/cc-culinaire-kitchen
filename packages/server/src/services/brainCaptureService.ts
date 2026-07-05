/**
 * @module brainCaptureService
 *
 * Capture side of the Brain — the per-user AI memory layer
 * (docs/specs/brain-memory.md, T4/T5).
 *
 * {@link recordMemory} is the single write entry point for every memory
 * source (Phase 1: chat turns; Phase 2: curated kitchen-ops events). It is
 * **best-effort by contract (spec E2): it catches everything internally and
 * NEVER rejects**, so callers can fire it as `void recordMemory(...)` after
 * their own write commits without any risk of breaking the primary action.
 *
 * Rows are inserted with `status = 'pending'`; the async {@link module:brainWorker}
 * claims them, embeds the body, and marks them `ready` for recall.
 *
 * Privacy: bodies are sanitized/redacted by `brainSanitize` before storage
 * and are NEVER logged — logs carry ids + outcome only.
 */

import pino from "pino";
import { db } from "../db/index.js";
import { brainMemory } from "../db/schema.js";
import { sanitizeMemoryText } from "./brainSanitize.js";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "brainCaptureService" });

/**
 * In-process capture counters, exposed for the admin Brain stats endpoint
 * (spec T9 observability). Reset on process restart — trend data lives in
 * the `brain_memory` table itself; these catch "capture is silently broken".
 */
const captureCounters = { recorded: 0, skipped: 0, errors: 0 };

/** Snapshot of the in-process capture counters (T9). */
export function getCaptureCounters(): { recorded: number; skipped: number; errors: number } {
  return { ...captureCounters };
}

/** Input to {@link recordMemory}. */
export interface RecordMemoryInput {
  /** Author/owner. Guests (userId <= 0) are never recorded. */
  userId: number;
  /** Org for scope='org' rows (Phase 2). Ignored-but-stored in Phase 1. */
  organisationId?: number | null;
  /** Visibility tier. Defaults to 'user'. */
  scope?: "user" | "org";
  /** Curated taxonomy (spec D4). Phase 1 uses 'chat' only. */
  sourceType: "chat" | "recipe" | "purchase_order" | "waste" | "stock" | "menu" | "prep";
  /** Originating entity id — the upsert key with (userId, sourceType). NULL for chat. */
  sourceRef?: string | null;
  /** Optional short label shown in "Your Brain". Sanitized + truncated. */
  title?: string | null;
  /** Raw content to remember. Sanitized/redacted before storage. */
  rawContent: string;
  /** 'event' (default) | 'digest' (Phase 3 compaction). */
  kind?: "event" | "digest";
}

/**
 * Record a memory. Best-effort: resolves void on success AND on every
 * failure (spec E2) — errors are logged with a structured `alert` marker
 * (`brain_capture_error`) that the T9 log alert keys on.
 *
 * Upsert semantics: `unique(user_id, source_type, source_ref)` is the
 * conflict target. A NULL `sourceRef` (chat) never conflicts in Postgres,
 * so chat turns always insert; ops events (Phase 2) update-in-place and
 * re-enter the embed queue.
 */
export async function recordMemory(input: RecordMemoryInput): Promise<void> {
  try {
    // Guests never record (spec capture pipeline).
    if (!input.userId || input.userId <= 0) {
      captureCounters.skipped++;
      return;
    }

    // Flag gate: capture is inert until brain_enabled AND brain_capture_enabled.
    const settings = await getAllSettings();
    if (settings.brain_enabled !== "true" || settings.brain_capture_enabled !== "true") {
      captureCounters.skipped++;
      return;
    }

    const body = sanitizeMemoryText(input.rawContent);
    if (!body) {
      // Nothing worth remembering once sanitized — not an error.
      captureCounters.skipped++;
      return;
    }

    const title = sanitizeMemoryText(input.title).slice(0, 200) || null;

    await db
      .insert(brainMemory)
      .values({
        userId: input.userId,
        organisationId: input.organisationId ?? null,
        scope: input.scope ?? "user",
        memoryKind: input.kind ?? "event",
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
        title,
        body,
      })
      .onConflictDoUpdate({
        target: [brainMemory.userId, brainMemory.sourceType, brainMemory.sourceRef],
        set: {
          title,
          body,
          // Content changed → previous embedding is stale; re-enter the queue.
          embedding: null,
          status: "pending",
          attemptCount: 0,
          nextAttemptDttm: null,
          updatedDttm: new Date(),
        },
      });

    captureCounters.recorded++;
    logger.info(
      { userId: input.userId, sourceType: input.sourceType, sourceRef: input.sourceRef ?? null },
      "brain.capture.recorded",
    );
  } catch (err) {
    // NEVER throw/reject (spec E2). Capture is best-effort; a Brain failure
    // must never break chat or an ops write. The `alert` marker is the hook
    // for the capture-error-rate alert (spec T9 — Phase-1 exit criterion).
    captureCounters.errors++;
    logger.error(
      {
        err,
        alert: "brain_capture_error",
        userId: input.userId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef ?? null,
      },
      "brain.capture.error — memory not recorded",
    );
  }
}
