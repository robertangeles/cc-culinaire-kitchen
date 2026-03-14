/**
 * @module middleware/guestAuth
 *
 * Middleware for authenticating guest users via X-Guest-Token header.
 * Used on chat and conversation endpoints to allow anonymous access.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/authService.js";
import { getGuestSession } from "../services/guestService.js";

/** Extends Express Request with guest session info. */
declare global {
  namespace Express {
    interface Request {
      guestToken?: string;
    }
  }
}

/**
 * Attempts JWT authentication first. If no JWT cookie is present,
 * falls back to guest token authentication via X-Guest-Token header.
 * Returns 401 only if neither authentication method succeeds.
 */
export async function authenticateOrGuest(req: Request, res: Response, next: NextFunction) {
  // Try JWT auth first
  const token = req.cookies?.access_token;
  if (token) {
    try {
      req.user = verifyAccessToken(token);
      next();
      return;
    } catch {
      // JWT invalid — fall through to guest auth
    }
  }

  // Try guest token
  const guestToken = req.headers["x-guest-token"] as string | undefined;
  if (guestToken) {
    const session = await getGuestSession(guestToken);
    if (session) {
      req.guestToken = guestToken;
      next();
      return;
    }
  }

  res.status(401).json({ error: "Authentication required." });
}
