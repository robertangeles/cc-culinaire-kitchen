/**
 * @module middleware/rateLimiter
 *
 * Per-route rate limiting middleware factories using express-rate-limit.
 * The global rate limit (60 req/min) is applied in index.ts; these
 * provide stricter per-endpoint limits keyed by authenticated user ID.
 */

import { rateLimit } from "express-rate-limit";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import { mfaSessionUserId } from "../services/authService.js";

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
  message: { error: "Too many chat requests — please wait a moment before trying again.", code: "RATE_LIMITED" },
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
 * Rate limiter for the account-settings endpoints that take a password
 * (`POST /api/users/change-password`, `/delete-account`). Sign-in, registration and the
 * other public auth endpoints each have their own bucket below, so they do not spend this one.
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
 *
 * Keying uses `req.ip`, which Express resolves from `X-Forwarded-For` according
 * to the `trust proxy` setting. We deliberately do NOT read client-controlled
 * headers like `CF-Connecting-IP` directly — when the origin is reachable
 * outside Cloudflare, an attacker could forge that header and rotate the key to
 * defeat the limiter. The non-spoofable way to get the real client IP behind
 * Cloudflare is to set `TRUST_PROXY` to Cloudflare's published CIDR ranges (or
 * the exact hop count): Express then honours `X-Forwarded-For` only from those
 * trusted hops and ignores forged values. See index.ts.
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
  message: { error: "Too many attempts — please wait a minute before trying again.", code: "RATE_LIMITED" },
});

/**
 * Rate limiter for the compliance document view-url endpoint
 * (`GET /api/compliance/documents/:id/view-url`).
 *
 * 30 requests per minute, keyed by authenticated user ID. Two costs to guard
 * here, not one: each request mints a Cloudinary signed URL (a metered
 * per-call cost, see documentStorageService.ts), and the endpoint is an
 * id-enumeration surface — a denied guess still returns fast, so without a
 * limit a caller with any compliance:read-* permission could sweep document
 * ids cheaply. 30/min covers a manager working through a verification queue
 * in one sitting with room to spare, while bounding both costs per caller.
 */
export const complianceDocumentViewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `compliance-view-user-${req.user.sub}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many document requests — please wait a moment before trying again." },
});

/**
 * Rate limiter for self-service edit/delete of a compliance document
 * (`PUT`/`DELETE /api/compliance/documents/:id`).
 *
 * 20 requests per minute, keyed by authenticated user ID. deleteDocument
 * holds a DB row lock for the duration of an external Cloudinary API call
 * (see complianceService.ts's own comment on that tradeoff) — a pooled
 * connection, not just app time. Without a limit, a single caller firing
 * concurrent deletes at their own document could pin enough of the app's
 * connection pool (postgres-js default: 10) to stall unrelated requests
 * for as long as those calls take. 20/min covers correcting a typo a few
 * times or cleaning up a handful of mistaken uploads in one sitting, while
 * bounding a scripted hammering loop.
 */
export const complianceDocumentEditRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `compliance-edit-user-${req.user.sub}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many document changes — please wait a moment before trying again." },
});

/**
 * Rate limiter for the compliance report PDF export
 * (`GET /api/compliance/report.pdf`).
 *
 * 10 requests per 5 minutes, keyed by authenticated user ID. Unlike the
 * view-url limiter above (a cheap signed-URL mint), this renders a full PDF
 * in memory via @react-pdf/renderer for every staff member and document type
 * an org tracks — a real CPU + memory cost per call — so an unlimited
 * endpoint is a trivial DoS. 10/5min covers an admin working through several
 * venue-scoped exports in one audit-prep session with room to spare, while
 * bounding a scripted hammering loop.
 */
export const complianceReportRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.sub) return `compliance-report-user-${req.user.sub}`;
    return req.ip ?? "unknown";
  },
  message: { error: "Too many report requests — please wait a few minutes before trying again." },
});

/**
 * Per-address brake on `POST /api/auth/mfa/verify`, in its own bucket so MFA sign-ins do not
 * spend the login budget. Only failed codes count (`skipSuccessfulRequests`), so a kitchen of
 * staff signing in behind one NAT is not throttled by its own successes. IP hashed as above.
 */
export const mfaVerifyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const ip = req.ip ?? "unknown";
    return `mfa-verify-ip-${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
  },
  message: { error: "Too many attempts — please wait a minute before trying again.", code: "RATE_LIMITED" },
});

const mfaAccountOf = (req: Request): number | null =>
  req.user?.sub ?? mfaSessionUserId(req.body?.mfaSessionToken);

/**
 * Per-account cap on failed MFA proofs: wrong codes on `/mfa/verify`, wrong password or code on
 * `/mfa/setup`, `/mfa/enable` and `/mfa/disable`. 5 failures per 15 minutes per account, so an
 * attacker rotating IPs against one account is still stopped. Successful requests do not count.
 *
 * The account comes from the session (`req.user`) or, on `/mfa/verify`, from a *verified* MFA
 * session token. A request that names no account is skipped here and left to the per-address
 * limiter: an unverified claim must never pick the bucket.
 */
export const mfaAccountRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // 409 MFA_ALREADY_ENABLED is refused before any password or code is checked, so it is not a failed guess.
  requestWasSuccessful: (_req: Request, res: Response) => res.statusCode < 400 || res.statusCode === 409,
  skip: (req: Request) => mfaAccountOf(req) == null,
  keyGenerator: (req: Request) => `mfa-account-${mfaAccountOf(req)}`,
  message: { error: "Too many failed attempts — please wait 15 minutes before trying again.", code: "RATE_LIMITED" },
});

const hashIp = (req: Request) => createHash("sha256").update(req.ip ?? "unknown").digest("hex").slice(0, 32);

/**
 * One bucket per public auth endpoint, per hashed address. Sharing a single bucket meant a chef
 * signing in could be locked out by another person's password-reset attempts, and (counting
 * successes) a shift change behind one kitchen's NAT could lock everyone out.
 */
function ipBucket(name: string, limit: number, opts: { skipSuccessfulRequests?: boolean } = {}) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...opts,
    keyGenerator: (req: Request) => `${name}-ip-${hashIp(req)}`,
    message: { error: "Too many attempts — please wait a minute before trying again.", code: "RATE_LIMITED" },
  });
}

/** Sign-in: only failed attempts count, so successful sign-ins behind one NAT never lock each other out. */
export const loginRateLimit = ipBucket("login", 20, { skipSuccessfulRequests: true });
export const registerRateLimit = ipBucket("register", 20);
export const forgotPasswordRateLimit = ipBucket("forgot-password", 10);
export const resetPasswordRateLimit = ipBucket("reset-password", 10);
export const resendVerificationRateLimit = ipBucket("resend-verification", 5);
export const verifyEmailRateLimit = ipBucket("verify-email", 20);
export const googleIdTokenRateLimit = ipBucket("google-idtoken", 20);
export const appleIdTokenRateLimit = ipBucket("apple-idtoken", 20);
export const appleLinkRateLimit = ipBucket("apple-link", 10);
export const logoutRateLimit = ipBucket("logout", 60);

/**
 * Refresh: a device refreshes about once an hour, so the per-address cap is for a flood, not for a
 * busy kitchen (dozens of tablets behind one NAT), and a second cap per token stops one token being hammered.
 */
export const refreshRateLimit = ipBucket("refresh", 300);
export const refreshTokenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const token = req.cookies?.refresh_token ?? req.body?.refreshToken;
    return typeof token === "string" ? `refresh-token-${createHash("sha256").update(token).digest("hex").slice(0, 32)}` : `refresh-token-none-${hashIp(req)}`;
  },
  message: { error: "Too many attempts — please wait a minute before trying again." },
});

/** Whoever is asking: the signed-in user, else the guest token, else the address. A guest's token is theirs alone, so a shared NAT does not share a bucket. */
const senderKey = (req: Request) => (req.user?.sub ? `user-${req.user.sub}` : req.guestToken ? `guest-${req.guestToken}` : `ip-${hashIp(req)}`);

/** A bucket per route for work that spends money or sends mail, counted per person over a window of minutes. */
function senderBucket(
  name: string,
  windowMinutes: number,
  limit: number,
  what: string,
  keyOf: (req: Request) => string | null = senderKey,
) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req: Request) => keyOf(req) === null,
    keyGenerator: (req: Request) => `${name}-${keyOf(req)}`,
    message: { error: `Too many ${what} — please wait a few minutes before trying again.`, code: "RATE_LIMITED" },
  });
}

/** Recipe generation chains up to three model calls and an image; refine is one call; an image is one paid call. */
export const recipeGenerateRateLimit = senderBucket("recipe-generate", 10, 10, "recipes generated");
export const recipeRefineRateLimit = senderBucket("recipe-refine", 10, 20, "recipe refinements");
export const recipeImageRateLimit = senderBucket("recipe-image", 10, 10, "image requests");

/**
 * A purchase order PDF is rendered in this process (CPU and memory, up to 10 s). Downloading it and emailing it to the
 * supplier (which attaches it) share this one bucket per user.
 */
export const poPdfRateLimit = senderBucket("po-pdf", 10, 20, "PDF requests");

/**
 * Emailing a recipe: anyone, guests included, may send to any address, so three caps. Each sender gets a few an hour,
 * and each recipient address a few an hour from everyone together, which is what stops this being used to flood one inbox.
 * Guest tokens are free to mint, so all the guests behind one address also share a cap; signed-in users are not counted in it.
 */
export const recipeEmailRateLimit = senderBucket("recipe-email", 60, 10, "recipe emails");
export const recipeEmailGuestAddressRateLimit = senderBucket("recipe-email-guest-ip", 60, 10, "recipe emails", (req) => (req.user ? null : hashIp(req)));
export const recipeEmailRecipientRateLimit = senderBucket("recipe-email-to", 60, 3, "emails to that address", (req) => recipientKey(req.body?.to));

/**
 * One key for one inbox: lower case, no `+tag`, and for Gmail no dots and one domain name. Null when it is not an address,
 * which skips the limiter and lets the handler answer 400. Other providers that ignore dots or add their own aliases are
 * not covered; the per-sender cap above still bounds those.
 */
export function recipientKey(to: unknown): string | null {
  if (typeof to !== "string") return null;
  const address = to.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  let local = address.slice(0, at).split("+")[0];
  let domain = address.slice(at + 1);
  if (at < 1 || !local || !domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return createHash("sha256").update(`${local}@${domain}`).digest("hex").slice(0, 32);
}
