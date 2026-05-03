/**
 * @module controllers/mobileFeatureFlagsController
 *
 * Controller for the mobile feature-flag endpoint
 * (`GET /api/mobile/feature-flags`).
 *
 * The endpoint is authenticated (Bearer JWT or web cookie) so anonymous
 * scrapers can't enumerate active flags. The response is allowed to be
 * cached at the edge for ~1h since the payload is identical for every
 * authenticated user today; if per-user flags are added later this
 * controller is the place to drop the Cache-Control to private/no-store.
 */

import type { Request, Response, NextFunction } from "express";
import { getMobileFeatureFlags } from "../services/featureFlagsService.js";

/**
 * **GET /api/mobile/feature-flags** — Return the active mobile feature flags.
 *
 * @returns 200 `{ languages_enabled: string[], ... }`
 * @returns 401 if the JWT is missing or invalid (handled upstream by `authenticate`).
 * @returns 429 if the per-route rate limiter is exceeded.
 */
export async function handleGetMobileFeatureFlags(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const flags = await getMobileFeatureFlags();
    // Edge-cacheable for ~1h. Drop to `private, no-store` if per-user
    // flags are added — at that point the payload diverges per JWT.
    res.set("Cache-Control", "public, max-age=3600");
    res.json(flags);
  } catch (err) {
    next(err);
  }
}
