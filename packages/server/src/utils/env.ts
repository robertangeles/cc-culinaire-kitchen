/**
 * @module utils/env
 *
 * Centralised environment variable accessors.
 * Every env-dependent default lives here — no more scattered fallbacks.
 */

/** Frontend origin used for CORS, OAuth redirects, email links, etc. */
export const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5179";

/** Backend port */
export const PORT = parseInt(process.env.PORT ?? "3009", 10);

/**
 * Minimum mobile app version allowed by version-gated endpoints.
 * Compared against the `X-Mobile-App-Version` request header. v1.3 only
 * gates `POST /api/mobile/feedback` (per eng-review finding 1.3 in
 * needs-frontend.md 2026-05-04). Older clients receive 426 with a JSON body
 * `{ error: 'upgrade_required', minVersion }`.
 *
 * Bump this whenever a wire-format-incompatible change ships. Default
 * "1.3.0" matches the mobile build that introduced the feedback feature.
 */
export const MIN_MOBILE_APP_VERSION = process.env.MIN_MOBILE_APP_VERSION ?? "1.3.0";

/**
 * Inbox that receives feedback emails forwarded by the async retry job.
 * Server fails fast at boot if unset (see assertFeedbackEmailConfig).
 */
export const RESEND_FEEDBACK_INBOX = process.env.RESEND_FEEDBACK_INBOX ?? "ran@robertangeles.com";
