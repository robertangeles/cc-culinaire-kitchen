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

const log = pino({ transport: { target: "pino-pretty" } });

const MessagesSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
  webSearch: z.boolean().optional(),
});

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
 * @returns A promise that resolves once the response has been sent or the
 *          error has been forwarded to the error-handling middleware.
 */
export async function handleChatStream(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = MessagesSchema.safeParse(req.body);

  if (!parsed.success) {
    log.warn({ error: parsed.error.flatten() }, "Chat validation failed");
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    log.info({ messageCount: parsed.data.messages.length, webSearch: parsed.data.webSearch }, "Chat request");
    await streamChat(parsed.data.messages, res, {
      webSearch: parsed.data.webSearch,
      userId: req.user?.sub ?? 0,
    });
  } catch (err) {
    log.error(err, "Chat stream error");
    next(err);
  }
}

const ImagePromptSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

/**
 * Handles an image generation request. Validates the prompt and returns
 * a JSON response with the generated image URL.
 */
export async function handleImageGeneration(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const parsed = ImagePromptSchema.safeParse(req.body);

  if (!parsed.success) {
    log.warn({ error: parsed.error.flatten() }, "Image prompt validation failed");
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    log.info({ promptLength: parsed.data.prompt.length }, "Image generation request");
    const result = await generateImage(parsed.data.prompt);
    if (!result) {
      res.status(503).json({ error: "Image generation is not available." });
      return;
    }
    res.json({ imageUrl: result.url, mimeType: result.mimeType });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not configured")) {
      res.status(503).json({ error: err.message });
      return;
    }
    log.error(err, "Image generation error");
    next(err);
  }
}
