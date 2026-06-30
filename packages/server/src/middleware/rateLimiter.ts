/**
 * @module middleware/rateLimiter
 *
 * Per-route rate limiting middleware factories using express-rate-limit.
 * The global rate limit (60 req/min) is applied in index.ts; these
 * provide stricter per-endpoint limits keyed by authenticated user ID.
 */

import { rateLimit } from "express-rate-limit";
import { createHash } from "crypto";
import type { Request } from "express";

/**
 * Rate limiter for the chat endpoint.
 * 20 requests per minute, keyed by authenticated user ID (falls back to IP).
 */
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `user-${req.user.sub}`;
    if (req.guestToken) return `guest-${req.guestToken}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many chat requests — please wait a moment before trying again." },
});

/**
 * Rate limiter for the mobile prompt-fetch endpoint.
 * 30 requests per minute, keyed by authenticated user ID (falls back to IP).
 *
 * Mobile clients fetch prompt bodies infrequently (typically once on app
 * launch and on version-bump invalidation) so 30/min is generous for normal
 * use. Above that we assume scraping or buggy retry loops and throttle.
 */
export const mobilePromptRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `user-${req.user.sub}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many prompt-fetch requests — please wait a moment before trying again." },
});

/**
 * Rate limiter for the mobile RAG retrieval endpoint.
 * 60 requests per minute, keyed by authenticated user ID (falls back to IP).
 *
 * RAG fires on every chat message — the cap needs headroom above the prompt
 * fetch limit (30/min) since users send messages much faster than they
 * relaunch the app. 60/min is one query per second sustained, which is
 * comfortably more than any human typing pace; bursting beyond is a retry
 * loop or scraper, throttle.
 */
export const mobileRagRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `user-${req.user.sub}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many retrieval requests — please slow down before trying again." },
});

/**
 * Rate limiter for the mobile feedback endpoint (`POST /api/mobile/feedback`).
 *
 * Per `needs-frontend.md` 2026-05-04:
 *   - **10 / hour** for authenticated users (keyed by user_id)
 *   - **3 / hour** per IP for anonymous submissions (login-screen path)
 *
 * Anonymous IPs are stored as a one-way SHA-256 hash so the rate-limiter's
 * in-memory key store never holds a recoverable IP. The DB row itself
 * never receives any IP information — that invariant is enforced in the
 * controller, not here.
 *
 * `standardHeaders: "draft-8"` causes the `Retry-After` header to be sent
 * on 429 responses, which the mobile client parses for the cooldown
 * countdown UX (`ApiError.retryAfter`). Do NOT remove that flag without
 * coordinating a mobile change.
 */
export const feedbackRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  standardHeaders: "draft-8",
  legacyHeaders: false,
  limit: (req: Request) => (req.user?.sub ? 10 : 3),
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `feedback-user-${req.user.sub}`;
    // Defense-in-depth: hash the IP so the in-memory key store never
    // holds a recoverable IP for anon submitters.
    const ip = req.ip ?? "unknown";
    const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
    return `feedback-ip-${hash}`;
  },
  message: { error: "rate_limited" },
});

/**
 * Rate limiter for the unauthenticated auth endpoints
 * (`POST /api/auth/login`, `/register`, `/forgot-password`).
 *
 * 20 requests per minute per IP. This is the abuse backstop for the
 * *non-browser* path: Cloudflare Turnstile is enforced only on requests
 * that carry a browser `Origin` header (web), so native/scripted clients
 * skip the captcha. This limiter throttles credential-stuffing and
 * password-reset spam from those clients without blocking a busy
 * shared-IP kitchen during a shift change.
 *
 * The IP is stored as a one-way SHA-256 hash so the in-memory key store
 * never holds a recoverable IP for login attempts.
 */
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const ip = req.ip ?? "unknown";
    const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
    return `auth-ip-${hash}`;
  },
  message: { error: "Too many attempts — please wait a minute before trying again." },
});
