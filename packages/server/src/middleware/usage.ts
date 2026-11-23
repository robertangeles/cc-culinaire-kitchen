/**
 * @module middleware/usage
 *
 * Middleware to check if a free-tier user has remaining sessions.
 * Returns 403 with `upgradeRequired: true` if exhausted.
 */

import type { Request, Response, NextFunction } from "express";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import { checkGuestUsageLimit } from "./guestUsage.js";
import { incrementGuestSessions } from "../services/guestService.js";

const logger = pino({ name: "usage" });

/**
 * Checks whether the authenticated user has usage quota remaining.
 * Paid subscribers (`subscriptionStatus === "active"`) bypass this check.
 * Free-tier users must have `free_sessions > 0`.
 */
export async function checkUsageLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return;
  }

  try {
    const rows = await db
      .select({
        freeSessions: user.freeSessions,
        subscriptionStatus: user.subscriptionStatus,
      })
      .from(user)
      .where(eq(user.userId, req.user.sub));

    if (rows.length === 0) {
      res.status(401).json({ error: "User not found.", code: "UNAUTHENTICATED" });
      return;
    }

    const { freeSessions, subscriptionStatus } = rows[0];

    // Paid users have unlimited access
    if (subscriptionStatus === "active") {
      next();
      return;
    }

    // Free users need remaining sessions
    if (freeSessions <= 0) {
      res.status(403).json({
        error: "You have used all your free sessions. Please upgrade to continue.",
        code: "FREE_SESSIONS_EXHAUSTED",
        upgradeRequired: true,
      });
      return;
    }

    next();
  } catch {
    next();
  }
}

/**
 * Spends one free session. A single UPDATE, so concurrent requests each take one and the count never
 * goes below zero; paid subscribers are never charged.
 */
export async function decrementFreeSessions(userId: number) {
  const charged = await db
    .update(user)
    .set({ freeSessions: sql`${user.freeSessions} - 1`, updatedDttm: new Date() })
    .where(and(eq(user.userId, userId), gt(user.freeSessions, 0), ne(user.subscriptionStatus, "active")))
    .returning({ freeSessions: user.freeSessions });

  if (charged.length > 0) {
    logger.debug({ userId, freeSessions: charged[0].freeSessions }, "decrementFreeSessions: session decremented");
  }
}

/** Checks the quota of whoever is asking: the signed-in user's free sessions, or the guest's. */
export function checkSessionQuota(req: Request, res: Response, next: NextFunction) {
  return req.user ? checkUsageLimit(req, res, next) : checkGuestUsageLimit(req, res, next);
}

/**
 * Spends one session for whoever asked. Call it only once the work succeeded and the answer was sent:
 * a request that failed, was refused or was abandoned by the client costs nothing.
 */
export async function chargeSession(req: Request) {
  try {
    if (req.user) await decrementFreeSessions(req.user.sub);
    else if (req.guestToken) await incrementGuestSessions(req.guestToken);
  } catch (err) {
    // The answer is already sent; a failed charge must not turn it into an error.
    logger.error({ err }, "chargeSession: could not record the session");
  }
}
