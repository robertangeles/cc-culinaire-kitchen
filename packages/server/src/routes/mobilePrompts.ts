/**
 * @module routes/mobilePrompts
 *
 * Express router for the mobile-only prompt-fetch endpoint, mounted at
 * `/api/mobile/prompts`.
 *
 * Endpoints:
 *   GET /api/mobile/prompts/:slug — Fetch an on-device prompt body for the
 *                                   companion mobile app's local model.
 *
 * Middleware pipeline (applied in order):
 *   1. {@link authenticate} — Requires a valid JWT (web cookie or mobile
 *      Bearer header). No role gate beyond authenticated; any signed-in
 *      user may fetch device prompts.
 *   2. {@link mobilePromptRateLimit} — 30 req/min/user (or IP for guests,
 *      though guests fail step 1 anyway).
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { mobilePromptRateLimit } from "../middleware/rateLimiter.js";
import { handleGetMobilePrompt } from "../controllers/mobilePromptsController.js";

export const mobilePromptsRouter = Router();

mobilePromptsRouter.get("/:slug", authenticate, mobilePromptRateLimit, handleGetMobilePrompt);
