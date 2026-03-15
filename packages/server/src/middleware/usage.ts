/**
 * @module middleware/usage
 *
 * Middleware to check if a free-tier user has remaining sessions.
 * Returns 403 with `upgradeRequired: true` if exhausted.
 */

import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";

const logger = pino({ name: "usage" });

/**
 * Checks whether the authenticated user has usage quota remaining.
 * Paid subscribers (`subscriptionStatus === "active"`) bypass this check.
 * Free-tier users must have `free_sessions > 0`.
 */
export async function checkUsageLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
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
      res.status(401).json({ error: "User not found." });
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
 * Decrements the free session count for free-tier users when
 * a new conversation is created.
 */
export async function decrementFreeSessions(userId: number) {
  const rows = await db
    .select({
      freeSessions: user.freeSessions,
      subscriptionStatus: user.subscriptionStatus,
    })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0) {
    logger.warn({ userId }, "decrementFreeSessions: user not found");
    return;
  }

  const { freeSessions, subscriptionStatus } = rows[0];

  // Only decrement for free-tier users
  if (subscriptionStatus === "active" || freeSessions <= 0) {
    return;
  }

  await db
    .update(user)
    .set({ freeSessions: freeSessions - 1, updatedDttm: new Date() })
    .where(eq(user.userId, userId));

  logger.debug({ userId, freeSessions: freeSessions - 1 }, "decrementFreeSessions: session decremented");
}
