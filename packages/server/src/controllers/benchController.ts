/**
 * @module controllers/benchController
 *
 * REST handlers for The Bench community chat.
 * Real-time messaging is handled via Socket.io; these endpoints
 * serve message history, search, pins, and mentions.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  getUserChannels,
  getChannelByKey,
  getMessages,
  getPinnedMessages,
  pinMessage,
  unpinMessage,
  searchMessages,
  getUnreadMentions,
  markMentionsRead,
  getOrCreateOrgChannel,
  getUserOrganisationIds,
  updateChannelBanner,
} from "../services/benchService.js";
import {
  getOrCreateThread,
  getThreadsForUser,
  getDmMessages,
  getThreadById,
} from "../services/benchDmService.js";

/** GET /api/bench/channels */
export async function handleGetChannels(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const channels = await getUserChannels(userId);
    res.json(channels);
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/channels/:key/messages */
export async function handleGetMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const channelKey = req.params.key as string;

    const channel = await getChannelByKey(channelKey);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    // Verify org membership for org channels
    if (channel.channelType === "organisation" && channel.organisationId) {
      const orgIds = await getUserOrganisationIds(userId);
      if (!orgIds.includes(channel.organisationId)) {
        res.status(403).json({ error: "Not a member of this organisation" });
        return;
      }
    }

    const before = req.query.before as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await getMessages(channel.channelId, { before, limit });
    res.json({ messages, channelId: channel.channelId });
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/channels/:key/pins */
export async function handleGetPins(req: Request, res: Response, next: NextFunction) {
  try {
    const channelKey = req.params.key as string;
    const channel = await getChannelByKey(channelKey);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const pins = await getPinnedMessages(channel.channelId);
    res.json(pins);
  } catch (err) {
    next(err);
  }
}

const pinSchema = z.object({ messageId: z.string().uuid() });

/** POST /api/bench/channels/:key/pins */
export async function handlePinMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const channelKey = req.params.key as string;
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid message ID" });
      return;
    }

    const channel = await getChannelByKey(channelKey);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    await pinMessage(parsed.data.messageId, channel.channelId, userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/bench/pins/:messageId */
export async function handleUnpinMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const messageId = req.params.messageId as string;
    await unpinMessage(messageId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/channels/:key/search */
export async function handleSearchMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const channelKey = req.params.key as string;
    const channel = await getChannelByKey(channelKey);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const q = (req.query.q as string) ?? "";
    if (!q.trim()) {
      res.json([]);
      return;
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const results = await searchMessages(channel.channelId, q, { limit, offset });
    res.json(results);
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/mentions/unread */
export async function handleGetUnreadMentions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const result = await getUnreadMentions(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/mentions/read */
export async function handleMarkMentionsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    await markMentionsRead(userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/channels/org — Create/get org channel for user's org */
export async function handleGetOrCreateOrgChannel(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const orgIds = await getUserOrganisationIds(userId);
    if (orgIds.length === 0) {
      res.status(404).json({ error: "Not a member of any organisation" });
      return;
    }
    // Use first org (V1: one org per user)
    const { organisationName } = req.body;
    const channel = await getOrCreateOrgChannel(orgIds[0], organisationName || "My Kitchen");
    res.json(channel);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/bench/channels/:key/banner — Update channel banner (org owner only) */
export async function handleUpdateChannelBanner(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const channelKey = req.params.key as string;

    const channel = await getChannelByKey(channelKey);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    // Only org owners can update org channel banners
    if (channel.channelType === "organisation" && channel.organisationId) {
      const orgIds = await getUserOrganisationIds(userId);
      if (!orgIds.includes(channel.organisationId)) {
        res.status(403).json({ error: "Not a member of this organisation" });
        return;
      }
    }

    const banner = (req.body.banner as string) ?? "";
    if (banner.length > 500) {
      res.status(400).json({ error: "Banner must be 500 characters or fewer" });
      return;
    }

    await updateChannelBanner(channelKey, banner);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Direct Messages
// ---------------------------------------------------------------------------

/** GET /api/bench/dm/threads */
export async function handleGetDmThreads(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const threads = await getThreadsForUser(userId);
    res.json(threads);
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/dm/threads/:threadId/messages */
export async function handleGetDmMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const threadId = parseInt(req.params.threadId as string, 10);
    if (isNaN(threadId)) {
      res.status(400).json({ error: "Invalid thread ID" });
      return;
    }

    // Verify user is part of this thread
    const thread = await getThreadById(threadId);
    if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }

    const before = req.query.before as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await getDmMessages(threadId, { before, limit });
    res.json({ messages });
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/dm/threads — create or get thread { recipientId } */
export async function handleCreateDmThread(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const recipientId = req.body.recipientId;
    if (!recipientId || typeof recipientId !== "number") {
      res.status(400).json({ error: "recipientId required" });
      return;
    }
    if (recipientId === userId) {
      res.status(400).json({ error: "Cannot message yourself" });
      return;
    }
    const thread = await getOrCreateThread(userId, recipientId);

    // Look up recipient's profile for the frontend
    const { db } = await import("../db/index.js");
    const { user: userTable } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [recipient] = await db
      .select({ userName: userTable.userName, userPhotoPath: userTable.userPhotoPath })
      .from(userTable)
      .where(eq(userTable.userId, recipientId))
      .limit(1);

    res.json({
      ...thread,
      otherUserName: recipient?.userName ?? "Chef",
      otherUserPhotoPath: recipient?.userPhotoPath ?? null,
    });
  } catch (err) {
    next(err);
  }
}
