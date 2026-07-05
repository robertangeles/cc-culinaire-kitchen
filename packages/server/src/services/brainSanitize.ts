/**
 * @module brainSanitize
 *
 * Capture-side sanitizer for Brain memories (docs/specs/brain-memory.md T3).
 *
 * Every memory body is passed through {@link sanitizeMemoryText} BEFORE it is
 * stored or embedded. Two threat classes are addressed at this boundary:
 *
 * 1. **Prompt injection** — memory bodies are later injected into AI system
 *    prompts (the `## Brain Memory` block). Angle-bracket tags, instruction
 *    markers (SYSTEM:/INSTRUCTION:/…), markdown headers, and code-fence
 *    markers are stripped so a captured chat turn cannot break out of the
 *    block or masquerade as platform instructions.
 * 2. **PII in embeddings/logs** — emails, phone-like and card-like digit
 *    runs are redacted before the text ever reaches the embedding API or
 *    the database. Bodies are additionally NEVER logged (ids + outcome only).
 *
 * The sanitizer is deliberately conservative with numbers: culinary
 * quantities ("350 g", "180°C", "12 portions") are short digit runs and are
 * left untouched; only long, separator-joined runs that look like phone or
 * card numbers are redacted.
 */

/** Hard cap on stored body length — keeps embeddings inside model limits. */
export const MAX_MEMORY_BODY_LENGTH = 8000;

/** Email addresses → redacted placeholder. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Card-like digit runs: 13–19 digits allowing single space/dash separators
 * (e.g. "4111 1111 1111 1111"). Checked BEFORE phones so a card number is
 * labelled as a number, not a phone.
 */
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;

/**
 * Phone-like runs: an optional leading + then 8+ digits with optional
 * space/dash/dot/paren separators. 8+ keeps culinary quantities safe.
 */
const PHONE_RE = /(?:\+|\b)(?:[\d][ ().-]?){8,}\d\b/g;

/**
 * Sanitize free text for storage as a Brain memory body or title.
 *
 * Returns an empty string for null/undefined/empty input — callers treat an
 * empty result as "nothing worth remembering" and skip the insert.
 */
export function sanitizeMemoryText(text: string | null | undefined): string {
  if (!text) return "";

  let out = text
    // Control chars (keep \n and \t) — defends logs, DB, and the prompt.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    // Angle-bracket tags (spec threat model: "<>-strip"). Removes HTML/XMLish
    // tags a memory could use to spoof structure inside the prompt.
    .replace(/<[^>]*>/g, "")
    // Instruction-marker neutralisation — same set as userContextService's
    // sanitizeForPrompt, kept in sync deliberately.
    .replace(/SYSTEM:|INSTRUCTION:|ASSISTANT:|USER:/gi, "")
    // Markdown headers: a body starting "## …" could visually escape the
    // labelled `## Brain Memory` block. Strip the marker, keep the text.
    .replace(/^#{1,6}\s+/gm, "")
    // Code-fence markers: keep the fenced CONTENT (recipes legitimately
    // contain it) but drop the ``` markers that could break block structure.
    .replace(/```[^\n]*/g, "");

  // PII redaction — order matters: emails, then card-like, then phone-like.
  out = out
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(CARD_RE, "[redacted-number]")
    .replace(PHONE_RE, "[redacted-number]");

  // Whitespace normalisation + length cap.
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > MAX_MEMORY_BODY_LENGTH) {
    out = out.slice(0, MAX_MEMORY_BODY_LENGTH).trimEnd();
  }

  return out;
}
