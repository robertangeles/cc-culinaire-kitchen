/**
 * @module controllers/kitchenProfileController
 *
 * Handles GET and PUT for the authenticated user's kitchen profile
 * (skill level, cuisine preferences, dietary restrictions, equipment).
 *
 * Routes (mounted under /api/users, all require authentication):
 *   GET /api/users/kitchen-profile   — retrieve the user's profile
 *   PUT /api/users/kitchen-profile   — create or update the profile
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getProfile, upsertProfile } from "../services/userContextService.js";

const logger = pino({ name: "kitchenProfileController" });

const KitchenProfileUpdateSchema = z.object({
  skillLevel: z
    .enum(["home_cook", "culinary_student", "line_cook", "sous_chef", "head_chef"])
    .optional(),
  cuisinePreferences: z.array(z.string().max(100)).max(20).optional(),
  dietaryRestrictions: z.array(z.string().max(100)).max(20).optional(),
  kitchenEquipment: z.array(z.string().max(100)).max(30).optional(),
  servingsDefault: z.number().int().min(1).max(100).optional(),
  onboardingDoneInd: z.boolean().optional(),
});

/**
 * GET /api/users/kitchen-profile
 * Returns the authenticated user's kitchen profile (with defaults when none exists).
 */
export async function handleGetKitchenProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const profile = await getProfile(req.user.sub);
    res.json(profile);
  } catch (err) {
    logger.error({ userId: req.user.sub, err }, "handleGetKitchenProfile: failed");
    next(err);
  }
}

/**
 * PUT /api/users/kitchen-profile
 * Creates or updates the authenticated user's kitchen profile.
 * Accepts partial updates — only provided fields are changed.
 */
export async function handleUpsertKitchenProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = KitchenProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid kitchen profile data.",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const profile = await upsertProfile(req.user.sub, parsed.data);
    logger.info({ userId: req.user.sub }, "handleUpsertKitchenProfile: saved");
    res.json(profile);
  } catch (err) {
    logger.error({ userId: req.user.sub, err }, "handleUpsertKitchenProfile: failed");
    next(err);
  }
}
