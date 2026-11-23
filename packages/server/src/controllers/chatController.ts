/**
 * @module chatController
 *
 * Controller for the chat stream endpoint. Validates incoming message
 * payloads against a Zod schema and delegates to the AI service for
 * streamed responses. Validation failures are returned as 400 errors;
 * unexpected errors are forwarded to the Express error-handling middleware.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import { streamChat } from "../services/aiService.js";
import { generateImage } from "../services/imageService.js";
import { resolveActiveOrg } from "../services/activeOrgService.js";
import { ChatRequestSchema } from "@culinaire/shared";
import { requestDeadline, afterDeadline } from "../utils/requestDeadline.js";

/** A chat answer may use up to 15 tool steps; past this the model call is cut off. */
const CHAT_TIMEOUT_MS = 180_000;
/** One paid image call. */
const IMAGE_TIMEOUT_MS = 60_000;

const log = pino({ transport: { target: "pino-pretty" } });

/**
 * Handles an incoming chat request by validating the message array and
 * streaming the AI-generated response back to the client.
 *
 * @param req - Express request whose body must contain a `messages` array.
 *              Each message must have a `role` ("user" | "assistant") and
 *              a `content` string.
 * @param res - Express response used to stream the AI reply. If validation
 *              fails, a 400 JSON response is sent instead.
 * @param next - Express next function, called with the error when the
 *               stream encounters an unexpected failure.
 * @returns A promise that resolves, once the response has been sent or the error
 *          forwarded to the error-handling middleware, to whether an answer
 *          reached the client (the caller charges a session only then).
 */
export async function handleChatStream(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<boolean> {
  const parsed = ChatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    log.warn({ error: parsed.error.flatten() }, "Chat validation failed");
    res.status(400).json({ error: "Invalid chat request.", code: "VALIDATION", details: parsed.error.flatten() });
    return false;
  }

  const deadline = requestDeadline(res, CHAT_TIMEOUT_MS);
  try {
    log.info({ messageCount: parsed.data.messages.length, webSearch: parsed.data.webSearch }, "Chat request");
    // Resolve the active org for org-shared Brain recall (spec T11) here —
    // OUTSIDE streamChat's 2s recall budget race — so the 1-2 membership
    // lookups don't spend recall's budget. resolveActiveOrg does its own live
    // membership recheck; any failure degrades to user-scope recall only.
    const userId = req.user?.sub ?? 0;
    const activeOrgId = userId ? await resolveActiveOrg(userId).catch(() => null) : null;
    return await streamChat(parsed.data.messages, res, {
      webSearch: parsed.data.webSearch,
      userId,
      activeOrgId,
      abortSignal: deadline.signal,
    });
  } catch (err) {
    log.error(err, "Chat stream error");
    const toSend = afterDeadline(err, deadline);
    if (toSend) next(toSend);
    return false;
  }
}

const ImagePromptSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

/**
 * Handles an image generation request. Validates the prompt and returns
 * a JSON response with the generated image URL. Resolves to whether an
 * image was sent (the caller charges a session only then).
 */
export async function handleImageGeneration(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<boolean> {
  const parsed = ImagePromptSchema.safeParse(req.body);

  if (!parsed.success) {
    log.warn({ error: parsed.error.flatten() }, "Image prompt validation failed");
    res.status(400).json({ error: "Invalid image request.", code: "VALIDATION", details: parsed.error.flatten() });
    return false;
  }

  const deadline = requestDeadline(res, IMAGE_TIMEOUT_MS);
  try {
    log.info({ promptLength: parsed.data.prompt.length }, "Image generation request");
    const result = await generateImage(parsed.data.prompt, deadline.signal);
    if (!result) {
      res.status(503).json({ error: "Image generation is not available.", code: "AI_UNAVAILABLE" });
      return false;
    }
    res.json({ imageUrl: result.url, mimeType: result.mimeType });
    return true;
  } catch (err) {
    log.error(err, "Image generation error");
    const toSend = afterDeadline(err, deadline);
    if (toSend) next(toSend);
    return false;
  }
}
