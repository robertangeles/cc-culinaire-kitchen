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
import { shouldRememberChatTurn } from "./brainDistillService.js";
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

/** Input to {@link recordChatTurn}. */
export interface RecordChatTurnInput {
  /** Author/owner. Guests (userId <= 0) are never recorded. */
  userId: number;
  /** Optional short label shown in "Your Brain" (the first user message). */
  title?: string | null;
  /** The composed, sanitized chat turn ("Cook asked: … / CulinAIre answered: …"). */
  rawContent: string;
}

/**
 * Record a chat turn, passing it through the capture-time relevance gate
 * (docs/specs/brain-memory.md — the distillation deviation from D10).
 *
 * When `brain_distillation_enabled` is on, a Balanced keep/drop judge decides
 * whether the turn carries durable signal BEFORE it is inserted, so noise turns
 * (pure retrieval questions, chit-chat) never appear in "Your Brain". When the
 * flag is off, this is a straight pass-through to {@link recordMemory} — raw
 * capture, identical to the pre-distillation behaviour.
 *
 * Best-effort like {@link recordMemory}: never throws. Callers fire it as
 * `void recordChatTurn(...)` after the message write.
 */
export async function recordChatTurn(input: RecordChatTurnInput): Promise<void> {
  try {
    // Guests never record — skip the judge call too.
    if (!input.userId || input.userId <= 0) {
      captureCounters.skipped++;
      return;
    }

    const settings = await getAllSettings();
    // Capture disabled → do nothing (and never spend a judge call).
    if (settings.brain_enabled !== "true" || settings.brain_capture_enabled !== "true") {
      captureCounters.skipped++;
      return;
    }

    // Relevance gate (Balanced). Fail-open inside shouldRememberChatTurn.
    if (settings.brain_distillation_enabled === "true") {
      const verdict = await shouldRememberChatTurn(input.rawContent);
      if (!verdict.remember) {
        captureCounters.skipped++;
        logger.info(
          { userId: input.userId, sourceType: "chat", reason: verdict.reason },
          "brain.capture.distill_skip",
        );
        return;
      }
    }

    await recordMemory({
      userId: input.userId,
      sourceType: "chat",
      title: input.title ?? null,
      rawContent: input.rawContent,
    });
  } catch (err) {
    // Same best-effort contract as recordMemory — never break chat.
    captureCounters.errors++;
    logger.error(
      { err, alert: "brain_capture_error", userId: input.userId, sourceType: "chat" },
      "brain.capture.error — chat turn not recorded",
    );
  }
}

/**
 * Structured input to {@link recordOpsEvent} — a discriminated union on
 * `sourceType` (docs/specs/brain-memory.md T12). Each variant carries only the
 * fields its template needs. The memory body is built deterministically in code
 * ({@link buildOpsBody}) — NO LLM — so ops capture is free, instant, and has no
 * prompt-injection surface. Free-text fields are sanitized before framing.
 *
 * Scope follows the data: kitchen-ops entities that carry an `organisationId`
 * are `scope: 'org'` (shared with the kitchen); recipes have no org column and
 * are `scope: 'user'` (private to the author).
 */
export type RecordOpsEventInput = { userId: number; sourceRef: string; title?: string | null } & (
  | {
      sourceType: "recipe";
      scope: "user";
      organisationId?: null;
      stage: "saved" | "refined";
      recipeName: string;
      domain?: string | null;
      requestSummary?: string | null;
      changeSummary?: string | null;
    }
  | {
      sourceType: "purchase_order";
      scope: "org";
      organisationId: number;
      stage: "submitted" | "approved" | "received";
      poNumber: string;
      supplierName?: string | null;
      linesDescription?: string | null;
      totalValue?: string | null;
    }
  | {
      sourceType: "waste";
      scope: "user" | "org";
      organisationId?: number | null;
      ingredientName: string;
      quantity: string;
      unit: string;
      estimatedCost?: string | null;
      reason?: string | null;
    }
  | {
      sourceType: "stock";
      scope: "org";
      organisationId: number;
      locationDescription?: string | null;
    }
  | {
      sourceType: "prep";
      scope: "user" | "org";
      organisationId?: number | null;
      prepDate: string;
      tasksCompleted: number;
      tasksTotal: number;
      actualCovers?: number | null;
      notes?: string | null;
    }
  | {
      sourceType: "menu";
      scope: "user" | "org";
      organisationId?: number | null;
      action: "created" | "updated";
      itemName: string;
      category: string;
      sellingPrice: string;
    }
);

/**
 * Build the deterministic memory body for an ops event (spec T12). Every
 * user-derived string field is passed through `sanitizeMemoryText` BEFORE it is
 * framed by the template scaffolding (lesson #57: sanitize each part, then
 * frame — so injected markup can't ride in on the structural words). Numeric,
 * price, id, and date fields are structured data and interpolated as-is.
 */
function buildOpsBody(input: RecordOpsEventInput): string {
  const s = (v: string | null | undefined) => sanitizeMemoryText(v ?? "");
  switch (input.sourceType) {
    case "recipe": {
      const name = s(input.recipeName);
      if (input.stage === "refined") {
        const change = s(input.changeSummary);
        return `Recipe refined: ${name}.${change ? ` Changes: ${change}.` : ""}`;
      }
      const domain = s(input.domain);
      const req = s(input.requestSummary);
      return `Recipe saved: ${name}.${domain ? ` Domain: ${domain}.` : ""}${req ? ` Request: ${req}.` : ""}`;
    }
    case "purchase_order": {
      const po = s(input.poNumber);
      const supplier = s(input.supplierName);
      const total = input.totalValue ? ` Total: ${input.totalValue}.` : "";
      if (input.stage === "submitted") {
        const lines = s(input.linesDescription);
        return `Purchase order ${po} submitted${supplier ? ` to ${supplier}` : ""}.${lines ? ` Lines: ${lines}.` : ""}${total}`;
      }
      if (input.stage === "approved") {
        return `Purchase order ${po} approved${supplier ? ` — supplier ${supplier}` : ""}.${total}`;
      }
      return `Stock received on purchase order ${po}${supplier ? ` from ${supplier}` : ""}.`;
    }
    case "waste": {
      const ing = s(input.ingredientName);
      const unit = s(input.unit);
      const reason = s(input.reason);
      const cost = input.estimatedCost ? ` Estimated cost: ${input.estimatedCost}.` : "";
      return `Waste logged: ${input.quantity} ${unit} of ${ing}.${reason ? ` Reason: ${reason}.` : ""}${cost}`;
    }
    case "stock": {
      const loc = s(input.locationDescription);
      return `Stock count approved${loc ? ` for ${loc}` : ""}.`;
    }
    case "prep": {
      const notes = s(input.notes);
      const covers = input.actualCovers != null ? ` Covers: ${input.actualCovers}.` : "";
      return `Prep session completed for ${s(input.prepDate)}. Tasks done: ${input.tasksCompleted}/${input.tasksTotal}.${covers}${notes ? ` Notes: ${notes}.` : ""}`;
    }
    case "menu": {
      const name = s(input.itemName);
      const cat = s(input.category);
      const verb = input.action === "created" ? "created" : "updated";
      return `Menu item ${verb}: ${name}${cat ? ` (${cat})` : ""}${input.sellingPrice ? `, priced at ${input.sellingPrice}` : ""}.`;
    }
  }
}

/**
 * Record a curated kitchen-ops event as a Brain memory (spec T12). Fired as
 * `void recordOpsEvent(...)` AFTER the ops write commits, so a capture failure
 * can never roll back the primary action. Best-effort like {@link recordMemory}
 * — never throws.
 *
 * The body is a deterministic template (no LLM, no keep/drop gate — ops events
 * are curated/high-signal by construction). Guest/flag gating and body
 * sanitisation are handled by {@link recordMemory}; the early guards here mirror
 * {@link recordChatTurn} and avoid building a body that would be dropped anyway.
 */
export async function recordOpsEvent(input: RecordOpsEventInput): Promise<void> {
  try {
    if (!input.userId || input.userId <= 0) {
      captureCounters.skipped++;
      return;
    }

    const settings = await getAllSettings();
    if (settings.brain_enabled !== "true" || settings.brain_capture_enabled !== "true") {
      captureCounters.skipped++;
      return;
    }

    await recordMemory({
      userId: input.userId,
      organisationId: input.organisationId ?? null,
      scope: input.scope,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      title: input.title ?? null,
      rawContent: buildOpsBody(input),
    });
  } catch (err) {
    // Same best-effort contract as recordMemory — never break the ops write.
    captureCounters.errors++;
    logger.error(
      { err, alert: "brain_capture_error", userId: input.userId, sourceType: input.sourceType },
      "brain.capture.error — ops event not recorded",
    );
  }
}
