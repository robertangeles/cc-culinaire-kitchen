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
import { checkSessionQuota, chargeSession } from "../middleware/usage.js";
import { chatRateLimit } from "../middleware/rateLimiter.js";
import { handleChatStream, handleImageGeneration } from "../controllers/chatController.js";

export const chatRouter = Router();

// POST /api/chat — Authenticate (JWT or guest), rate-limit,
// enforce usage limits, then stream the AI response. A session is charged
// only for an answer that reached the client.
chatRouter.post("/", authenticateOrGuest, chatRateLimit, checkSessionQuota, async (req, res, next) => {
  if (await handleChatStream(req, res, next)) await chargeSession(req);
});

// POST /api/chat/image — Generate an image from a text prompt.
// Same auth + rate-limit + usage pipeline as chat.
chatRouter.post("/image", authenticateOrGuest, chatRateLimit, checkSessionQuota, async (req, res, next) => {
  if (await handleImageGeneration(req, res, next)) await chargeSession(req);
});
