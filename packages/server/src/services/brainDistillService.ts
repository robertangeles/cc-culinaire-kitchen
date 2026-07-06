/**
 * @module brainDistillService
 *
 * Capture-time relevance gate for chat memories (docs/specs/brain-memory.md).
 *
 * Phase 1 originally captured every chat turn raw (spec D10). Local testing
 * showed that pure retrieval questions ("what's my pasta ratio?") then pile up
 * in "Your Brain" as noise, eroding the trust the feature exists to build. This
 * service pulls a *lightweight* slice of the Phase-3 distiller forward: a binary
 * "is this worth remembering?" judge that runs BEFORE a chat memory is inserted,
 * so noise turns never appear at all.
 *
 * It is NOT the full Phase-3 distiller — it does not rewrite, merge, or
 * summarise memories. It only answers keep/drop.
 *
 * Policy: **Balanced** — keep durable personal signal (preferences, kitchen/menu
 * facts, decisions, corrections) AND useful troubleshooting outcomes; drop pure
 * retrieval questions, greetings/acks, and generic knowledge lookups.
 *
 * Gated by `brain_distillation_enabled` (the caller checks the flag). Uses the
 * `brain_distillation_model` setting (verified live: `anthropic/claude-haiku-4-5`).
 *
 * Fail-open: any error, timeout, or unparseable reply resolves to
 * `{ remember: true }`. A judge outage must never silently drop the chef's
 * memories — occasional noise is a smaller failure than lost signal. Never throws.
 */

import pino from "pino";
import { generateText } from "ai";
import { getModel } from "./providerService.js";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "brainDistillService" });

/** Fallback model if the setting is somehow unset (verified working slug). */
const DEFAULT_DISTILL_MODEL = "anthropic/claude-haiku-4-5";

/** Max chars of the turn sent to the judge — bounds token cost on long turns. */
const MAX_JUDGE_INPUT_CHARS = 1500;

/**
 * Latency budget for the judge. Capture is fire-and-forget so this never blocks
 * a user request, but the race stops a hung provider from pinning resources —
 * and on timeout we fail OPEN (remember the turn) rather than drop it.
 */
const JUDGE_BUDGET_MS = 3000;

/**
 * Balanced keep/drop policy. Verified live against 5 canonical turns
 * (pasta question → SKIP, pasta statement / hollandaise fix → REMEMBER,
 * generic lookup / thanks → SKIP).
 */
const POLICY_SYSTEM = `You decide whether a chef's chat turn is worth saving to their long-term memory ("Your Brain").

KEEP (answer REMEMBER) when the turn contains durable, reusable signal about THIS chef or kitchen:
- a stated preference, ratio, or standard ("my pasta ratio is 100g flour per egg")
- a fact about their kitchen/menu/equipment/suppliers
- a decision or change ("we're switching to gluten-free on Tuesdays")
- a correction to something previously said
- a useful troubleshooting OUTCOME they'd want recalled ("my hollandaise fix = fresh yolk + warm water")

DROP (answer SKIP) when the turn is noise with no durable personal signal:
- a pure retrieval question asking for something already known ("what's my pasta ratio?")
- a general knowledge lookup with no personal hook ("how many grams in a cup?")
- greetings, thanks, acknowledgements, chit-chat

Answer with EXACTLY ONE WORD: REMEMBER or SKIP.`;

/** Verdict for a chat turn. */
export interface DistillVerdict {
  remember: boolean;
  reason: string;
}

/**
 * Judge whether a chat turn is worth remembering (Balanced policy).
 *
 * Best-effort and fail-open: resolves `{ remember: true }` on any error,
 * timeout, or unrecognised reply. Never rejects.
 *
 * @param content - The composed, sanitized chat turn ("Cook asked: … /
 *   CulinAIre answered: …"). Truncated to {@link MAX_JUDGE_INPUT_CHARS}.
 */
export async function shouldRememberChatTurn(content: string): Promise<DistillVerdict> {
  const text = content?.trim();
  if (!text) return { remember: false, reason: "empty" };

  try {
    const settings = await getAllSettings();
    const modelId = settings.brain_distillation_model || DEFAULT_DISTILL_MODEL;

    // classify() carries its own catch so it NEVER rejects — critical because
    // when the timeout wins the race, the classify promise keeps running and a
    // late rejection would otherwise be an unhandled promise rejection.
    const verdict = await Promise.race([
      classify(text.slice(0, MAX_JUDGE_INPUT_CHARS), modelId),
      new Promise<DistillVerdict>((resolve) =>
        setTimeout(() => resolve({ remember: true, reason: "timeout" }), JUDGE_BUDGET_MS).unref?.(),
      ),
    ]);

    return verdict;
  } catch (err) {
    // Fail-open: never lose a memory to a judge outage.
    logger.warn({ err }, "brain.distill.error — failing open (remember)");
    return { remember: true, reason: "judge-error" };
  }
}

/**
 * One-shot classification call. Returns a parsed verdict; **never rejects**
 * (fail-open on any error or ambiguity) so it is safe to leave running when it
 * loses the latency race in {@link shouldRememberChatTurn}.
 */
async function classify(content: string, modelId: string): Promise<DistillVerdict> {
  try {
    return await classifyInner(content, modelId);
  } catch (err) {
    logger.warn({ err }, "brain.distill.classify_error — failing open (remember)");
    return { remember: true, reason: "judge-error" };
  }
}

async function classifyInner(content: string, modelId: string): Promise<DistillVerdict> {
  const { text } = await generateText({
    model: getModel(modelId),
    system: POLICY_SYSTEM,
    prompt: `Chat turn:\n"""\n${content}\n"""\n\nVerdict (REMEMBER or SKIP):`,
    temperature: 0,
    maxTokens: 8,
  });

  const upper = text.trim().toUpperCase();
  if (upper.includes("SKIP")) return { remember: false, reason: "distilled-skip" };
  if (upper.includes("REMEMBER")) return { remember: true, reason: "distilled-keep" };
  // Unrecognised reply → fail open rather than silently drop.
  return { remember: true, reason: "unparsed" };
}
