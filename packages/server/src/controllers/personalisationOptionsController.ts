/**
 * @module controllers/personalisationOptionsController
 *
 * Handles public and admin REST endpoints for kitchen_profile_option.
 *
 * Public (authenticated):
 *   GET /api/personalisation-options     — active options grouped by type
 *
 * Admin (Administrator role required):
 *   GET    /api/admin/personalisation-options        — all options incl. inactive
 *   POST   /api/admin/personalisation-options        — create option
 *   PATCH  /api/admin/personalisation-options/:id    — update option
 *   DELETE /api/admin/personalisation-options/:id    — delete option
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import {
  getActiveOptions,
  getAllOptions,
  createOption,
  updateOption,
  deleteOption,
  type OptionType,
} from "../services/personalisationOptionsService.js";

const logger = pino({ name: "personalisationOptionsController" });

const VALID_TYPES: OptionType[] = ["skill_level", "cuisine", "dietary", "equipment"];

const CreateOptionSchema = z.object({
  optionType:        z.enum(["skill_level", "cuisine", "dietary", "equipment"]),
  optionValue:       z.string().min(1).max(100),
  optionLabel:       z.string().min(1).max(200),
  optionDescription: z.string().max(500).optional(),
  sortOrder:         z.number().int().min(0).optional(),
});

const UpdateOptionSchema = z.object({
  optionLabel:       z.string().min(1).max(200).optional(),
  optionDescription: z.string().max(500).nullable().optional(),
  sortOrder:         z.number().int().min(0).optional(),
  activeInd:         z.boolean().optional(),
});

/**
 * GET /api/personalisation-options
 * Returns active options for user-facing KitchenWizard and MyKitchenTab.
 */
export async function handleGetActiveOptions(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const options = await getActiveOptions();
    res.json(options);
  } catch (err) {
    logger.error({ err }, "handleGetActiveOptions failed");
    next(err);
  }
}

/**
 * GET /api/admin/personalisation-options
 * Returns all options including inactive — for admin Personalisation tab.
 */
export async function handleGetAllOptions(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const options = await getAllOptions();
    res.json(options);
  } catch (err) {
    logger.error({ err }, "handleGetAllOptions failed");
    next(err);
  }
}

/**
 * POST /api/admin/personalisation-options
 */
export async function handleCreateOption(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = CreateOptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    return;
  }

  try {
    const option = await createOption(parsed.data);
    res.status(201).json(option);
  } catch (err: unknown) {
    // Unique constraint violation (duplicate type+value)
    if (err instanceof Error && err.message.includes("unique")) {
      res.status(409).json({ error: "An option with that value already exists for this type." });
      return;
    }
    logger.error({ err }, "handleCreateOption failed");
    next(err);
  }
}

/**
 * PATCH /api/admin/personalisation-options/:id
 */
export async function handleUpdateOption(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid option ID." });
    return;
  }

  const parsed = UpdateOptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input.", details: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await updateOption(id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "Option not found." });
      return;
    }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "handleUpdateOption failed");
    next(err);
  }
}

/**
 * DELETE /api/admin/personalisation-options/:id
 */
export async function handleDeleteOption(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid option ID." });
    return;
  }

  try {
    const deleted = await deleteOption(id);
    if (!deleted) {
      res.status(404).json({ error: "Option not found." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "handleDeleteOption failed");
    next(err);
  }
}
