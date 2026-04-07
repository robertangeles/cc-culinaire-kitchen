/**
 * @module modelOptionsController
 *
 * Express request handlers for the model-options API.
 *
 * Delegates to {@link module:modelOptionService} and returns JSON responses.
 * Errors are forwarded to the Express error handler via `next()`.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import {
  listEnabledModels,
  listAllModels,
  fetchOpenRouterModels,
  enableModel,
  disableModel,
  updateModelSort,
} from "../services/modelOptionService.js";

const log = pino({ name: "modelOptionsController" });

/** Zod schema for the POST (enable) request body. */
const EnableSchema = z.object({
  modelId: z.string().min(1).max(150),
  displayName: z.string().min(1).max(200),
  provider: z.string().min(1).max(80),
  category: z.string().max(30).optional(),
  contextLength: z.number().int().nullable().optional(),
  inputCostPerM: z.string().nullable().optional(),
  outputCostPerM: z.string().nullable().optional(),
});

/** Zod schema for the PATCH (update sort) request body. */
const UpdateSortSchema = z.object({
  sortOrder: z.number().int().min(0),
});

/**
 * **GET /** — List enabled models (for prompt dropdown consumption).
 */
export async function handleListEnabled(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const category = req.query.category as string | undefined;
    const models = await listEnabledModels(category);
    res.json({ models });
  } catch (err) {
    log.error(err, "Failed to list enabled models");
    next(err);
  }
}

/**
 * **GET /all** — List all models including disabled (admin).
 */
export async function handleListAll(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const models = await listAllModels();
    res.json({ models });
  } catch (err) {
    log.error(err, "Failed to list all models");
    next(err);
  }
}

/**
 * **GET /available** — Fetch full OpenRouter catalog (admin).
 */
export async function handleFetchAvailable(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const models = await fetchOpenRouterModels();
    res.json({ models });
  } catch (err) {
    log.error(err, "Failed to fetch OpenRouter models");
    next(err);
  }
}

/**
 * **POST /** — Enable a model from the OpenRouter catalog (admin).
 */
export async function handleEnable(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = EnableSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const model = await enableModel(parsed.data);
    log.info({ modelId: parsed.data.modelId }, "Model enabled via API");
    res.status(201).json({ model });
  } catch (err) {
    log.error(err, "Failed to enable model");
    next(err);
  }
}

/**
 * **DELETE /:id** — Soft-disable a model (admin).
 */
export async function handleDisable(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid model option ID" });
      return;
    }

    await disableModel(id);
    log.info({ modelOptionId: id }, "Model disabled via API");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to disable model");
    next(err);
  }
}

/**
 * **PATCH /:id** — Update sort order (admin).
 */
export async function handleUpdateSort(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid model option ID" });
      return;
    }

    const parsed = UpdateSortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await updateModelSort(id, parsed.data.sortOrder);
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to update model sort order");
    next(err);
  }
}
