/**
 * @module utils/escapeHtml
 *
 * Escape a string for interpolation into an HTML email body.
 *
 * Transactional emails in this codebase are built by string interpolation, and
 * several of the interpolated values are user-controlled: a staff member's
 * display name comes from registration, ingredient and venue names come from
 * operator input, and rule URLs are free text. Dropping any of those into a
 * template raw is stored HTML injection — a display name of
 * `<img src=x onerror=...>` renders in the recipient's mail client, and an
 * unvalidated `javascript:` href is click-to-execute in several webmail clients.
 *
 * Also escapes `'` (which the original copy in wasteDigestService did not), so
 * this is safe inside single-quoted attribute values as well as text nodes.
 *
 * NOT a general-purpose sanitiser: it escapes, it does not strip. For text on
 * its way into a model prompt use `brainSanitize` instead — different threat,
 * different tool.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Return `url` only when it is a plain http(s) link, otherwise null.
 *
 * Guards `<a href>` against `javascript:`, `data:` and other executable schemes
 * that some mail clients will happily follow.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Returns a copy of `value` with every string in it (at any depth, object keys included) HTML-escaped; numbers, booleans and null pass through. */
export function escapeStrings<T>(value: T): T {
  if (typeof value === "string") return escapeHtml(value) as T;
  if (Array.isArray(value)) return value.map(escapeStrings) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [escapeHtml(k), escapeStrings(v)])) as T;
  }
  return value;
}
