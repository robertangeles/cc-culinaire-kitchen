/**
 * @module middleware/guestUsage
 *
 * Middleware to check if a guest session has remaining conversations.
 * Returns 403 with registration prompt if exhausted.
 */

import type { Request, Response, NextFunction } from "express";
import { hasGuestQuota } from "../services/guestService.js";

/**
 * Checks whether the guest user has remaining conversation quota.
 * Guests are limited to 10 conversations before needing to register.
 */
export async function checkGuestUsageLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.guestToken) {
    res.status(401).json({ error: "Guest authentication required." });
    return;
  }

  try {
    const hasQuota = await hasGuestQuota(req.guestToken);
    if (!hasQuota) {
      res.status(403).json({
        error: "You have used all 10 free guest sessions. Please register to continue.",
        registrationRequired: true,
      });
      return;
    }

    next();
  } catch {
    next();
  }
}
