/**
 * @module services/turnstileService
 *
 * Server-side verification for Cloudflare Turnstile tokens.
 *
 * The browser solves a Turnstile challenge and submits a one-time token
 * alongside login / registration / password-reset requests. This service
 * exchanges that token + the secret key for a pass/fail verdict via
 * Cloudflare's siteverify API.
 *
 * Enforcement is hard (fail-closed): if the secret key is not configured,
 * or the network call fails, verification returns `success: false` so a
 * missing/broken configuration can never silently bypass the check.
 *
 * The secret key is read through {@link getCredentialValueWithFallback}
 * so it can be rotated live from Settings → Integrations → Cloudflare
 * without a server restart.
 */

import pino from "pino";
import { getCredentialValueWithFallback } from "./credentialService.js";

const logger = pino({ name: "turnstileService" });

/** Cloudflare's token verification endpoint. */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Outcome of a Turnstile verification attempt. */
export interface TurnstileResult {
  success: boolean;
  /** Cloudflare error codes (e.g. "invalid-input-response", "timeout-or-duplicate"). */
  errorCodes: string[];
}

/**
 * Verify a Turnstile token against Cloudflare.
 *
 * @param token    The `cf-turnstile-response` token from the browser widget.
 * @param remoteip Optional client IP for additional validation.
 * @returns        `{ success, errorCodes }`. Never throws — failures
 *                 (missing secret, network error, invalid token) all
 *                 resolve to `success: false`.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteip?: string,
): Promise<TurnstileResult> {
  const secret = await getCredentialValueWithFallback(
    "CLOUDFLARE_TURNSTILE_SECRET_KEY",
  );

  if (!secret) {
    logger.error(
      "Turnstile secret key is not configured — rejecting request. " +
        "Set it in Settings → Integrations → Cloudflare.",
    );
    return { success: false, errorCodes: ["missing-secret"] };
  }

  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteip) form.append("remoteip", remoteip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      // Verification runs inline in the auth path; cap the wait so a slow
      // Cloudflare endpoint can't hang login. On timeout the catch below
      // returns success:false (fail-closed).
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // Cloudflare returned a non-2xx (e.g. 5xx HTML error page). Fail closed,
      // and log the real status so an upstream incident is distinguishable from
      // a network/timeout error in the catch below.
      logger.error({ status: res.status }, "Turnstile siteverify returned non-OK status");
      return { success: false, errorCodes: [`http-${res.status}`] };
    }

    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    return {
      success: data.success === true,
      errorCodes: data["error-codes"] ?? [],
    };
  } catch (err) {
    logger.error(err, "Turnstile verification request failed");
    return { success: false, errorCodes: ["network-error"] };
  }
}
