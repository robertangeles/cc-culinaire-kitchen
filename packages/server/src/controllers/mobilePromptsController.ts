/**
 * @module controllers/mobilePromptsController
 *
 * Controller for the mobile-only prompt-fetch endpoint that lets the
 * companion mobile app pull a prompt body for a local on-device model.
 *
 * Validates the slug, calls the service, and maps typed errors to safe HTTP
 * responses. `PromptNotFoundError` and `PromptNotDeviceRuntimeError` both
 * map to 404 — the mobile client treats either as "no device prompt" and
 * uses its cached body. The shared 404 prevents authenticated callers from
 * enumerating which slugs are server-runtime vs. nonexistent.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import { getDevicePromptForMobile } from "../services/promptService.js";
import {
  PromptNotFoundError,
  PromptNotDeviceRuntimeError,
} from "../errors/promptErrors.js";

const log = pino({ transport: { target: "pino-pretty" } });

/**
 * Slug shape: lowercase letters, digits, and hyphens only. Length 1-100 to
 * match the underlying `prompt.prompt_key` varchar(100). The regex blocks
 * path-traversal characters (slashes, dots, backslashes) and unicode
 * tricks before the slug ever reaches a DB query.
 */
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, digits, and hyphens");

/**
 * **GET /api/mobile/prompts/:slug** — Fetch an on-device prompt body.
 *
 * @returns 200 `{ promptKey, promptBody, runtime, modelId, version, updatedAtDttm }`.
 * @returns 400 if the slug fails validation (path-traversal protection).
 * @returns 401 if the JWT is missing or invalid (handled upstream by `authenticate`).
 * @returns 404 if no device prompt exists for the slug (or the slug is server-runtime).
 * @returns 429 if the per-route rate limiter is exceeded.
 */
export async function handleGetMobilePrompt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parse = slugSchema.safeParse(req.params.slug);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid prompt slug.", details: parse.error.flatten() });
    return;
  }
  const slug = parse.data;

  try {
    const result = await getDevicePromptForMobile(slug);
    log.info(
      {
        userId: req.user?.sub,
        slug,
        version: result.version,
        responseBytes: result.promptBody.length,
      },
      "mobile.prompt_fetch",
    );
    res.json(result);
  } catch (err) {
    // 404 for both "doesn't exist" and "exists but not device runtime".
    // Different log levels so observability can distinguish reconnaissance
    // attempts (server-runtime probes) from honest cache misses.
    if (err instanceof PromptNotFoundError) {
      log.info({ userId: req.user?.sub, slug }, "mobile.prompt_fetch.not_found");
      res.status(404).json({ error: "Prompt not found." });
      return;
    }
    if (err instanceof PromptNotDeviceRuntimeError) {
      log.warn(
        { userId: req.user?.sub, slug, alert: "mobile.prompt_fetch.refused_server_runtime" },
        "Mobile client requested a server-runtime prompt — refusing",
      );
      res.status(404).json({ error: "Prompt not found." });
      return;
    }
    next(err);
  }
}
