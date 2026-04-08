/**
 * @module services/benchSocketService
 *
 * Socket.io lifecycle for The Bench community chat.
 * Handles real-time messaging, presence tracking, typing indicators,
 * reactions, and mention notifications.
 *
 * Architecture:
 * - Attaches to the existing HTTP server (same port as Express)
 * - Auth via httpOnly JWT cookie (same as REST API)
 * - One Socket.io room per bench_channel (bench:everyone, bench:org_1, etc.)
 * - In-memory presence map (single-server; swap to Redis adapter for scale)
 */

import { Server as HttpServer } from "http";
import { CLIENT_URL } from "../utils/env.js";
import { Server, Socket } from "socket.io";
import pino from "pino";
/** Parse cookie header string into key-value pairs */
function parseCookie(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}
import { verifyAccessToken } from "./authService.js";
import {
  createMessage,
  getChannelByKey,
  addReaction,
  removeReaction,
  getReactions,
  softDeleteMessage,
  editMessage,
  getUserOrganisationIds,
} from "./benchService.js";
import { getOrCreateThread, createDmMessage, getThreadById } from "./benchDmService.js";
import { db } from "../db/index.js";
import { user as userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

const logger = pino({ name: "benchSocket" });

interface UserProfile {
  userId: number;
  userName: string;
  userPhotoPath: string | null;
}

/**
 * Presence system keyed by userId (not socketId).
 * Tracks how many sockets each user has — only removes when count hits 0.
 * This prevents flicker during Socket.io transport upgrades (polling → websocket)
 * which cause a brief disconnect/reconnect with a new socketId.
 */
const userProfiles = new Map<number, UserProfile>();
const userSocketCount = new Map<number, number>();
const typingMap = new Map<string, Map<number, { userName: string; timeout: ReturnType<typeof setTimeout> }>>();

let io: Server;

export function getIO(): Server {
  return io;
}

function addUserSocket(userId: number, profile: UserProfile) {
  userProfiles.set(userId, profile);
  userSocketCount.set(userId, (userSocketCount.get(userId) ?? 0) + 1);
}

/** Returns true if user has no more sockets (truly disconnected) */
function removeUserSocket(userId: number): boolean {
  const count = (userSocketCount.get(userId) ?? 1) - 1;
  if (count <= 0) {
    userSocketCount.delete(userId);
    userProfiles.delete(userId);
    return true;
  }
  userSocketCount.set(userId, count);
  return false;
}

/** Get all online users — simply returns everyone in userProfiles map */
function getAllOnlineUsers(): UserProfile[] {
  return Array.from(userProfiles.values());
}

/** Broadcast presence to everyone in a room */
function broadcastPresence(channelKey: string) {
  const users = getAllOnlineUsers();
  logger.debug({ channelKey, userCount: users.length, userIds: users.map(u => u.userId) }, "Bench: broadcasting presence");
  io.to(`bench:${channelKey}`).emit("bench:presence:update", { channelKey, users });
}

/**
 * Initialize Socket.io on the given HTTP server.
 * Called once from index.ts during startup.
 */
export function initBenchSocket(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    cors: {
      origin: CLIENT_URL,
      credentials: true,
    },
    path: "/socket.io",
  });

  // ── Auth middleware ────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return next(new Error("AUTH_REQUIRED"));

      const cookies = parseCookie(cookieHeader);
      const token = cookies["access_token"];
      if (!token) return next(new Error("AUTH_REQUIRED"));

      const payload = verifyAccessToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("AUTH_INVALID"));
    }
  });

  // ── Connection handler ────────────────────────────────────
  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.user.sub as number;
    logger.info({ userId, socketId: socket.id }, "Bench: user connected");

    // Look up user profile for display name and photo
    let userName = "Chef";
    let userPhotoPath: string | null = null;
    try {
      const [u] = await db
        .select({ userName: userTable.userName, userPhotoPath: userTable.userPhotoPath })
        .from(userTable)
        .where(eq(userTable.userId, userId))
        .limit(1);
      if (u) {
        userName = u.userName;
        userPhotoPath = u.userPhotoPath;
      }
    } catch {
      // Use defaults
    }

    // Register user (ref-counted — multiple sockets per user are fine)
    addUserSocket(userId, { userId, userName, userPhotoPath });

    // Auto-join the "everyone" room and personal DM room
    socket.join("bench:everyone");
    socket.join(`bench:user_${userId}`);
    broadcastPresence("everyone");

    // ── Join channel ──────────────────────────────────────
    socket.on("bench:join", async ({ channelKey }: { channelKey: string }) => {
      if (!channelKey || !/^[a-z0-9_]+$/.test(channelKey)) return;
      if (channelKey === "everyone") return; // already joined

      // Verify org membership for org channels
      if (channelKey.startsWith("org_")) {
        const orgId = parseInt(channelKey.replace("org_", ""), 10);
        if (isNaN(orgId)) return;
        const userOrgIds = await getUserOrganisationIds(userId);
        if (!userOrgIds.includes(orgId)) {
          socket.emit("bench:error", { error: "Not a member of this organisation" });
          return;
        }
      }

      socket.join(`bench:${channelKey}`);
      broadcastPresence(channelKey);
      logger.debug({ userId, channelKey }, "Bench: joined channel");
    });

    // ── Leave channel ─────────────────────────────────────
    socket.on("bench:leave", ({ channelKey }: { channelKey: string }) => {
      socket.leave(`bench:${channelKey}`);
      broadcastPresence(channelKey);
    });

    // ── Send message ──────────────────────────────────────
    socket.on("bench:message", async (data: {
      channelKey: string;
      body: string;
      messageType?: string;
      recipeId?: string;
    }) => {
      try {
        // Input validation
        if (!data.channelKey || !/^[a-z0-9_]+$/.test(data.channelKey)) return;
        if (!data.body?.trim() && data.messageType !== "recipe_share") return;
        if (data.body && data.body.length > 5000) {
          socket.emit("bench:error", { error: "Message too long (max 5000 characters)" });
          return;
        }

        const channel = await getChannelByKey(data.channelKey);
        if (!channel) return;

        // Verify org membership for org channels
        if (channel.channelType === "organisation") {
          const userOrgIds = await getUserOrganisationIds(userId);
          if (!channel.organisationId || !userOrgIds.includes(channel.organisationId)) return;
        }

        const message = await createMessage(
          channel.channelId,
          userId,
          data.body.trim(),
          (data.messageType as "text" | "recipe_share") || "text",
          data.recipeId,
        );

        // Broadcast to the channel room
        io.to(`bench:${data.channelKey}`).emit("bench:message:new", message);

        // Clear typing indicator
        clearTyping(data.channelKey, userId);
      } catch (err) {
        logger.error({ err, userId }, "Bench: message send failed");
        socket.emit("bench:error", { error: "Failed to send message" });
      }
    });

    // ── Typing indicator ──────────────────────────────────
    socket.on("bench:typing", ({ channelKey }: { channelKey: string }) => {
      setTyping(channelKey, userId, userName);
      socket.to(`bench:${channelKey}`).emit("bench:typing", { channelKey, userId, userName });
    });

    // ── Reactions ─────────────────────────────────────────
    socket.on("bench:reaction:add", async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      try {
        await addReaction(messageId, userId, emoji);
        const reactions = await getReactions(messageId);
        // Broadcast to all rooms this socket is in (scoped, not global)
        for (const room of socket.rooms) {
          if (room.startsWith("bench:")) {
            io.to(room).emit("bench:reaction:updated", { messageId, reactions });
            break;
          }
        }
      } catch (err) {
        logger.warn({ err, messageId, emoji }, "Bench: reaction add failed");
      }
    });

    socket.on("bench:reaction:remove", async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      try {
        await removeReaction(messageId, userId, emoji);
        const reactions = await getReactions(messageId);
        for (const room of socket.rooms) {
          if (room.startsWith("bench:")) {
            io.to(room).emit("bench:reaction:updated", { messageId, reactions });
            break;
          }
        }
      } catch (err) {
        logger.warn({ err, messageId, emoji }, "Bench: reaction remove failed");
      }
    });

    // ── Helper: broadcast to DM or channel ─────────────────
    async function broadcastToTarget(channelKey: string, event: string, payload: Record<string, unknown>) {
      if (channelKey.startsWith("dm_")) {
        // DM: broadcast to both users' personal rooms
        const threadId = parseInt(channelKey.replace("dm_", ""), 10);
        const thread = await getThreadById(threadId);
        if (thread) {
          io.to(`bench:user_${thread.userAId}`).emit(event, payload);
          io.to(`bench:user_${thread.userBId}`).emit(event, payload);
        }
      } else {
        // Channel: broadcast to the channel room
        io.to(`bench:${channelKey}`).emit(event, payload);
      }
    }

    // ── Delete message ────────────────────────────────────
    socket.on("bench:message:delete", async ({ messageId, channelKey }: { messageId: string; channelKey: string }) => {
      try {
        const isAdmin = (socket.data.user.roles as string[] ?? []).includes("Administrator");
        const deleted = await softDeleteMessage(messageId, userId, isAdmin);
        if (deleted) {
          await broadcastToTarget(channelKey, "bench:message:deleted", { messageId });
        }
      } catch (err) {
        logger.warn({ err, messageId }, "Bench: message delete failed");
      }
    });

    // ── Edit message ──────────────────────────────────────
    socket.on("bench:message:edit", async ({ messageId, channelKey, newBody }: { messageId: string; channelKey: string; newBody: string }) => {
      try {
        if (!newBody?.trim() || newBody.length > 5000) {
          socket.emit("bench:error", { error: "Invalid message" });
          return;
        }
        const edited = await editMessage(messageId, userId, newBody.trim());
        if (edited) {
          await broadcastToTarget(channelKey, "bench:message:edited", { messageId, newBody: newBody.trim(), editedInd: true });
        }
      } catch (err) {
        logger.warn({ err, messageId }, "Bench: message edit failed");
      }
    });

    // ── Direct Messages ────────────────────────────────────
    socket.on("bench:dm:send", async ({ recipientId, body }: { recipientId: number; body: string }) => {
      try {
        if (!body?.trim() || body.length > 5000) return;
        const thread = await getOrCreateThread(userId, recipientId);
        const message = await createDmMessage(thread.dmThreadId, userId, body.trim());
        // Send to both sender and recipient
        io.to(`bench:user_${userId}`).emit("bench:dm:new", message);
        io.to(`bench:user_${recipientId}`).emit("bench:dm:new", message);
      } catch (err) {
        logger.error({ err, userId, recipientId }, "Bench: DM send failed");
        socket.emit("bench:error", { error: "Failed to send message" });
      }
    });

    socket.on("bench:dm:typing", ({ recipientId }: { recipientId: number }) => {
      io.to(`bench:user_${recipientId}`).emit("bench:dm:typing", { userId, userName });
    });

    // ── Presence heartbeat (triggers a fresh broadcast) ───
    socket.on("bench:presence:heartbeat", () => {
      broadcastPresence("everyone");
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on("disconnect", () => {
      logger.info({ userId, socketId: socket.id }, "Bench: user disconnected");
      const fullyGone = removeUserSocket(userId);
      // Only broadcast presence change if user has NO remaining sockets.
      // During transport upgrades (polling → websocket), the old socket
      // disconnects but a new one connects immediately — count stays > 0.
      if (fullyGone) {
        broadcastPresence("everyone");
      }
      // Clear typing
      for (const [channelKey] of typingMap) {
        clearTyping(channelKey, userId);
      }
    });
  });

  logger.info("The Bench Socket.io initialized");
}

export function getOnlineUsers(_channelKey: string) {
  return getAllOnlineUsers();
}

// ── Typing helpers ────────────────────────────────────────────

function setTyping(channelKey: string, userId: number, userName: string) {
  if (!typingMap.has(channelKey)) typingMap.set(channelKey, new Map());
  const channel = typingMap.get(channelKey)!;
  const existing = channel.get(userId);
  if (existing) clearTimeout(existing.timeout);
  channel.set(userId, {
    userName,
    timeout: setTimeout(() => clearTyping(channelKey, userId), 3000),
  });
}

function clearTyping(channelKey: string, userId: number) {
  const channel = typingMap.get(channelKey);
  if (!channel) return;
  const entry = channel.get(userId);
  if (entry) {
    clearTimeout(entry.timeout);
    channel.delete(userId);
  }
}
