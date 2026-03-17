/**
 * @module promptsController
 *
 * Express request handlers for the prompt-management API.
 *
 * Handlers delegate to {@link module:promptService} and return JSON
 * responses. Errors are forwarded to the Express error handler via `next()`.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import {
  getPromptRaw,
  savePrompt,
  resetPrompt,
  getActivePromptId,
  listAllPrompts,
  createPrompt,
} from "../services/promptService.js";
import {
  getVersions,
  rollbackToVersion,
} from "../services/promptVersionService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for validating the PUT request body. */
const UpdateSchema = z.object({
  content: z.string().min(1, "Prompt content cannot be empty"),
});

/** Zod schema for validating the POST (create) request body. */
const CreateSchema = z.object({
  name: z.string().min(1, "Prompt name is required").max(100),
  content: z.string().min(1, "Prompt content cannot be empty"),
});

/**
 * **GET /** -- List all active prompts (metadata only, no body).
 *
 * @returns 200 `{ prompts: [...] }` with id, name, key, timestamps.
 */
export async function handleListPrompts(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const prompts = await listAllPrompts();
    res.json({ prompts });
  } catch (err) {
    log.error(err, "Failed to list prompts");
    next(err);
  }
}

/**
 * **POST /** -- Create a new prompt with both active and default copies.
 *
 * Request body: `{ name: string, content: string }`.
 * The prompt key is auto-generated from the name.
 *
 * @returns 201 `{ prompt: { promptId, promptName, promptKey } }`.
 * @returns 400 if validation fails.
 * @returns 409 if a prompt with the same key already exists.
 */
export async function handleCreatePrompt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const result = await createPrompt(parsed.data.name, parsed.data.content);
    log.info({ promptName: result.promptName, promptKey: result.promptKey }, "Prompt created");
    res.status(201).json({ prompt: result });
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      res.status(409).json({ error: err.message });
      return;
    }
    log.error(err, "Failed to create prompt");
    next(err);
  }
}

/**
 * **GET /:name** -- Retrieve the current (active) prompt content.
 *
 * @returns 200 `{ name, content }` on success.
 */
export async function getPrompt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.params.name as string;
    const content = await getPromptRaw(name);
    log.info({ name }, "Prompt retrieved");
    res.json({ name, content });
  } catch (err) {
    log.error(err, "Failed to get prompt");
    next(err);
  }
}

/**
 * **PUT /:name** -- Update the prompt with new content.
 *
 * Request body: `{ content: string }` (validated via Zod; must be non-empty).
 *
 * @returns 200 `{ success: true, name }` on success.
 * @returns 400 if the request body fails validation.
 */
export async function updatePrompt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.params.name as string;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await savePrompt(name, parsed.data.content);
    log.info({ name }, "Prompt updated");
    res.json({ success: true, name });
  } catch (err) {
    log.error(err, "Failed to update prompt");
    next(err);
  }
}

/**
 * **POST /:name/reset** -- Reset a prompt to its factory-default content.
 *
 * @returns 200 `{ name, content }` with the restored default body.
 */
export async function handleResetPrompt(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.params.name as string;
    const content = await resetPrompt(name);
    log.info({ name }, "Prompt reset to default");
    res.json({ name, content });
  } catch (err) {
    log.error(err, "Failed to reset prompt");
    next(err);
  }
}

/**
 * **GET /:name/versions** -- List version history for a prompt.
 *
 * Resolves the prompt name to the active `prompt_id`, then queries
 * `prompt_version` by FK for efficient integer-based lookups.
 *
 * @returns 200 `{ name, versions }` with an array of version snapshots,
 *          newest first.
 */
export async function listVersions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.params.name as string;

    const promptId = await getActivePromptId(name);
    if (promptId === null) {
      res.json({ name, versions: [] });
      return;
    }

    const versions = await getVersions(promptId);
    res.json({ name, versions });
  } catch (err) {
    log.error(err, "Failed to list versions");
    next(err);
  }
}

/**
 * **POST /:name/versions/:versionId/rollback** -- Restore a prompt to
 * a previous version's content.
 *
 * @returns 200 `{ name, content }` with the restored content.
 * @returns 404 if the prompt name or version ID is not found.
 */
export async function handleRollback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const name = req.params.name as string;
    const versionId = req.params.versionId as string;

    const id = parseInt(versionId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }

    const content = await rollbackToVersion(id);
    log.info({ name, versionId: id }, "Prompt rolled back");
    res.json({ name, content });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    log.error(err, "Failed to rollback version");
    next(err);
  }
}
