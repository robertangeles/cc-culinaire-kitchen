/**
 * @module conversations (router)
 *
 * Express router for the conversation-management API, mounted at `/api/conversations`.
 *
 * Endpoints:
 *  - `POST   /`               -- Create a new conversation.
 *  - `GET    /`               -- List all conversations (newest first).
 *  - `GET    /:id`            -- Get a conversation with all messages.
 *  - `PATCH  /:id`            -- Update conversation title.
 *  - `POST   /:id/messages`   -- Save messages to a conversation.
 *  - `DELETE /:id`            -- Delete a conversation and its messages.
 */

import { Router } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import {
  handleCreateConversation,
  handleListConversations,
  handleGetConversation,
  handleUpdateTitle,
  handleSaveMessages,
  handleDeleteConversation,
} from "../controllers/conversationController.js";

export const conversationsRouter = Router();

// All conversation routes require authentication (JWT or guest)
conversationsRouter.use(authenticateOrGuest);

conversationsRouter.post("/", handleCreateConversation);
conversationsRouter.get("/", handleListConversations);
conversationsRouter.get("/:id", handleGetConversation);
conversationsRouter.patch("/:id", handleUpdateTitle);
conversationsRouter.post("/:id/messages", handleSaveMessages);
conversationsRouter.delete("/:id", handleDeleteConversation);
