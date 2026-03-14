/**
 * @module guestRouter
 *
 * Express router for guest session management, mounted at `/api/guest`.
 *
 * Endpoints:
 *   POST /session  - Create a new guest session (server-generated token)
 *   GET  /session  - Get guest session usage info
 *
 * Anti-abuse: limits guest session creation to {@link MAX_SESSIONS_PER_IP}
 * sessions per client IP address.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { createGuestSession, getGuestUsage, countSessionsByIp, MAX_SESSIONS_PER_IP } from "../services/guestService.js";

const guestRouter = Router();

/** POST /api/guest/session — create a new guest session. */
guestRouter.post("/session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientIp = req.ip ?? "unknown";

    // Anti-abuse: check if this IP has exceeded the session creation limit
    if (clientIp !== "unknown") {
      const existingCount = await countSessionsByIp(clientIp);
      if (existingCount >= MAX_SESSIONS_PER_IP) {
        res.status(403).json({
          error: "Guest session limit reached for this device. Please register for unlimited access.",
          registrationRequired: true,
        });
        return;
      }
    }

    const token = randomUUID();
    const session = await createGuestSession(token, clientIp !== "unknown" ? clientIp : undefined);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

/** GET /api/guest/session — get usage info for a guest session. */
guestRouter.get("/session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers["x-guest-token"] as string;
    if (!token) {
      res.status(400).json({ error: "X-Guest-Token header required." });
      return;
    }

    const usage = await getGuestUsage(token);
    if (!usage) {
      res.status(404).json({ error: "Guest session not found." });
      return;
    }

    res.json(usage);
  } catch (err) {
    next(err);
  }
});

export default guestRouter;
