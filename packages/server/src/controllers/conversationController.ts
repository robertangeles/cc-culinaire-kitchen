/**
 * @module conversationController
 *
 * Express request handlers for the conversation-management API.
 *
 * Delegates to {@link module:conversationService} for database operations
 * and returns JSON responses. Errors are forwarded to the Express error
 * handler via `next()`.
 *
 * All handlers support both authenticated users (via `req.user`) and
 * guest users (via `req.guestToken`).
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import {
  createConversation,
  listConversations,
  getConversationWithMessages,
  updateConversationTitle,
  saveMessages,
  deleteConversation,
  createGuestConversation,
  listGuestConversations,
  getGuestConversationWithMessages,
  updateGuestConversationTitle,
  deleteGuestConversation,
} from "../services/conversationService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for creating a conversation. */
const CreateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
});

/** Zod schema for updating a conversation title. */
const UpdateTitleSchema = z.object({
  title: z.string().min(1).max(200),
});

/** Zod schema for a single message in a save-messages request. */
const MessageSchema = z.object({
  messageId: z.string().min(1),
  messageRole: z.enum(["user", "assistant"]),
  messageBody: z.string(),
  messageSequence: z.number().int().min(0),
});

/** Zod schema for saving messages to a conversation. */
const SaveMessagesSchema = z.object({
  messages: z.array(MessageSchema).min(1),
});

/**
 * **POST /** -- Create a new conversation.
 *
 * Request body: `{ id: string, title: string }`
 *
 * @returns 201 `{ success: true, conversationId }` on success.
 */
export async function handleCreateConversation(
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

    if (req.user) {
      await createConversation(parsed.data.id, parsed.data.title, req.user.sub);
    } else if (req.guestToken) {
      await createGuestConversation(parsed.data.id, parsed.data.title, req.guestToken);
    } else {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    log.info({ id: parsed.data.id }, "Conversation created");
    res.status(201).json({ success: true, conversationId: parsed.data.id });
  } catch (err) {
    log.error(err, "Failed to create conversation");
    next(err);
  }
}

/**
 * **GET /** -- List all conversations (newest first).
 *
 * @returns 200 `{ conversations }` with metadata array.
 */
export async function handleListConversations(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let conversations;

    if (req.user) {
      conversations = await listConversations(req.user.sub);
    } else if (req.guestToken) {
      conversations = await listGuestConversations(req.guestToken);
    } else {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    res.json({ conversations });
  } catch (err) {
    log.error(err, "Failed to list conversations");
    next(err);
  }
}

/**
 * **GET /:id** -- Get a conversation with all messages.
 *
 * @returns 200 `{ conversation }` with messages array.
 * @returns 404 if conversation not found.
 */
export async function handleGetConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    let conv;

    if (req.user) {
      conv = await getConversationWithMessages(id, req.user.sub);
    } else if (req.guestToken) {
      conv = await getGuestConversationWithMessages(id, req.guestToken);
    } else {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json({ conversation: conv });
  } catch (err) {
    log.error(err, "Failed to get conversation");
    next(err);
  }
}

/**
 * **PATCH /:id** -- Update conversation title.
 *
 * Request body: `{ title: string }`
 *
 * @returns 200 `{ success: true }` on success.
 */
export async function handleUpdateTitle(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = UpdateTitleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    if (req.user) {
      await updateConversationTitle(id, parsed.data.title, req.user.sub);
    } else if (req.guestToken) {
      await updateGuestConversationTitle(id, parsed.data.title, req.guestToken);
    } else {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    log.info({ id }, "Conversation title updated");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to update conversation title");
    next(err);
  }
}

/**
 * **POST /:id/messages** -- Save messages to a conversation.
 *
 * Request body: `{ messages: Array<{ messageId, messageRole, messageBody, messageSequence }> }`
 *
 * @returns 200 `{ success: true }` on success.
 */
export async function handleSaveMessages(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = SaveMessagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await saveMessages(id, parsed.data.messages);
    log.info({ id, count: parsed.data.messages.length }, "Messages saved");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to save messages");
    next(err);
  }
}

/**
 * **DELETE /:id** -- Delete a conversation and all its messages.
 *
 * @returns 200 `{ success: true }` on success.
 */
export async function handleDeleteConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    if (req.user) {
      await deleteConversation(id, req.user.sub);
    } else if (req.guestToken) {
      await deleteGuestConversation(id, req.guestToken);
    } else {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    log.info({ id }, "Conversation deleted");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to delete conversation");
    next(err);
  }
}
