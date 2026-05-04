/**
 * @module routes/mobileFeedback
 *
 * Express router for the mobile in-app feedback endpoint, mounted at
 * `/api/mobile/feedback`.
 *
 * Endpoint:
 *   POST /api/mobile/feedback — Submit a bug / feature / feedback row.
 *
 * Middleware pipeline (applied in order):
 *   1. {@link mobileVersionGuard}({ enforceMin: true }) — 400 on missing /
 *      malformed `X-Mobile-App-Version`, 426 on below-min. Sets
 *      `req.mobileAppVersion` for the controller.
 *   2. {@link authenticateOptional} — Attaches `req.user` IF a valid Bearer
 *      / cookie token is present; otherwise quietly continues (anon path).
 *      Invalid tokens still 401 (no downgrade attack).
 *   3. {@link feedbackRateLimit} — 10/hr/user (auth) or 3/hr/IP (anon).
 *      Retry-After header is set on 429 (consumed by the mobile cooldown UX).
 *   4. {@link handlePostMobileFeedback} — Zod-strict validation + persistence.
 *
 * The endpoint is contractual with the mobile build's
 * `feature/ck-mob/feedback-mvp` (commit `41a5f37`); see
 * shared-context `needs-frontend.md` 2026-05-04 PR-A.
 */

import { Router } from "express";
import { authenticateOptional } from "../middleware/auth.js";
import { mobileVersionGuard } from "../middleware/mobileVersionGuard.js";
import { feedbackRateLimit } from "../middleware/rateLimiter.js";
import { handlePostMobileFeedback } from "../controllers/mobileFeedbackController.js";

export const mobileFeedbackRouter = Router();

mobileFeedbackRouter.post(
  "/",
  mobileVersionGuard({ enforceMin: true }),
  authenticateOptional,
  feedbackRateLimit,
  handlePostMobileFeedback,
);
