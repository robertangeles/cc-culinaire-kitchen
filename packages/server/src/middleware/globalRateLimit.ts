/**
 * @module middleware/globalRateLimit
 *
 * Global `/api` rate limit. Signed-in users get their own bucket keyed by user
 * id (a shared office/NAT IP no longer shares one budget); anonymous traffic
 * stays on the IP at the stricter limit. A page load costs ~15 requests, so
 * the old IP-only 60/min broke the UI after about four page loads.
 */

import { rateLimit } from "express-rate-limit";
import type { Request } from "express";
import { verifyAccessToken } from "../services/authService.js";
import { extractAccessToken } from "./auth.js";

const ANON_LIMIT = 60;
const DEFAULT_USER_LIMIT = 300;

function userLimit(): number {
  const n = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_USER_LIMIT;
}

/** Verified user id, or null. A forged/expired token counts as anonymous. */
function verifiedUserId(req: Request): number | string | null {
  const token = extractAccessToken(req);
  if (!token) return null;
  try {
    return verifyAccessToken(token).sub ?? null;
  } catch {
    return null;
  }
}

export const globalApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: (req: Request) => (verifiedUserId(req) !== null ? userLimit() : ANON_LIMIT),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const id = verifiedUserId(req);
    return id !== null ? `user-${id}` : (req.ip ?? "unknown");
  },
  skip: (req) => req.path.startsWith("/api/auth/"),
  message: { error: "Too many requests, please try again later." },
});
