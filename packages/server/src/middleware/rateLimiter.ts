/**
 * @module middleware/rateLimiter
 *
 * Per-route rate limiting middleware factories using express-rate-limit.
 * The global rate limit (60 req/min) is applied in index.ts; these
 * provide stricter per-endpoint limits keyed by authenticated user ID.
 */

import { rateLimit } from "express-rate-limit";
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
