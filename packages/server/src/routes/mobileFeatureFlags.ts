/**
 * @module routes/mobileFeatureFlags
 *
 * Express router for the mobile feature-flag endpoint, mounted at
 * `/api/mobile/feature-flags`.
 *
 * Endpoints:
 *   GET /api/mobile/feature-flags — Return the active mobile feature flags
 *                                   (currently `languages_enabled`).
 *
 * Middleware pipeline (applied in order):
 *   1. {@link authenticate} — Requires a valid JWT (web cookie or mobile
 *      Bearer header).
 *   2. {@link mobilePromptRateLimit} — 30 req/min/user. Reused from the
 *      prompt-fetch route since the traffic shape is identical (cold-launch
 *      poll, occasional re-poll on cache invalidation).
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { mobilePromptRateLimit } from "../middleware/rateLimiter.js";
import { handleGetMobileFeatureFlags, handleGetMobileConfig } from "../controllers/mobileFeatureFlagsController.js";

export const mobileFeatureFlagsRouter = Router();

mobileFeatureFlagsRouter.get(
  "/",
  authenticate,
  mobilePromptRateLimit,
  handleGetMobileFeatureFlags,
);

/** Mounted at `/api/mobile/config`. Reachable by a build that is too old (see `mobileUpdateGate`), so it can say where to update. */
export const mobileConfigRouter = Router();
mobileConfigRouter.get("/", authenticate, mobilePromptRateLimit, handleGetMobileConfig);
