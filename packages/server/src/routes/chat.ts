/**
 * @module chatRouter
 *
 * Express router for the chat endpoints, mounted at `/api/chat`.
 *
 * Endpoints:
 *   POST /api/chat  -  Send a user message and receive a streamed AI response.
 *
 * Middleware pipeline (applied in order):
 *   1. {@link authenticateOrGuest} - Validates the user's auth token or guest
 *      token and attaches the authenticated user/guest to the request.
 *   2. {@link chatRateLimit} - Per-user/guest rate limiting (20/min).
 *   3. {@link checkUsageLimit} or {@link checkGuestUsageLimit} - Enforces
 *      per-user or per-guest usage limits.
 */

import { Router } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import { checkUsageLimit, decrementFreeSessions } from "../middleware/usage.js";
import { chatRateLimit } from "../middleware/rateLimiter.js";
import { handleChatStream, handleImageGeneration } from "../controllers/chatController.js";
import { checkGuestUsageLimit } from "../middleware/guestUsage.js";
import { incrementGuestSessions } from "../services/guestService.js";

export const chatRouter = Router();

// POST /api/chat — Authenticate (JWT or guest), rate-limit,
// enforce usage limits, then stream the AI response.
chatRouter.post("/", authenticateOrGuest, chatRateLimit, (req, res, next) => {
  if (req.user) {
    // Authenticated user — check subscription/free session limits
    checkUsageLimit(req, res, next);
  } else {
    // Guest user — check guest session limits
    checkGuestUsageLimit(req, res, next);
  }
}, async (req, res, next) => {
  let streamCompleted = false;
  try {
    await handleChatStream(req, res, next);
    streamCompleted = true;
  } finally {
    // Decrement session only when the stream resolved without throwing
    if (streamCompleted) {
      if (req.user) {
        await decrementFreeSessions(req.user.sub);
      } else if (req.guestToken) {
        await incrementGuestSessions(req.guestToken);
      }
    }
  }
});

// POST /api/chat/image — Generate an image from a text prompt.
// Same auth + rate-limit + usage pipeline as chat.
chatRouter.post("/image", authenticateOrGuest, chatRateLimit, (req, res, next) => {
  if (req.user) {
    checkUsageLimit(req, res, next);
  } else {
    checkGuestUsageLimit(req, res, next);
  }
}, async (req, res, next) => {
  await handleImageGeneration(req, res, next);
  // Decrement session after successful image generation
  if (res.writableEnded) {
    if (req.user) {
      await decrementFreeSessions(req.user.sub);
    } else if (req.guestToken) {
      await incrementGuestSessions(req.guestToken);
    }
  }
});
