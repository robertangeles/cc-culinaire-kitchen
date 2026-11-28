/**
 * @module services/benchSocketService
 *
 * Socket.io lifecycle for The Bench community chat.
 * Handles real-time messaging, presence tracking, typing indicators,
 * reactions, and mention notifications.
 *
 * Architecture:
 * - Attaches to the existing HTTP server (same port as Express)
 * - Auth via the JWT access token: httpOnly cookie (web) or handshake auth/Bearer (phone)
 * - One Socket.io room per bench_channel (bench:everyone, bench:org_1, etc.)
 * - In-memory presence map (single-server; swap to Redis adapter for scale)
 */

import { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { CLIENT_URL } from "../utils/env.js";
import { Server, Socket } from "socket.io";
import pino from "pino";
import { onBenchEvent } from "./benchSocketGuard.js";
import { extractHandshakeToken } from "../middleware/socketAuth.js";
import { verifyAccessToken } from "./authService.js";
import { AppError } from "../utils/appError.js";
import {
  createMessage,
  getChannelByKey,
  addReaction,
  removeReaction,
  getReactions,
  softDeleteMessage,
  editMessage,
  getUserOrganisationIds,
  getOrganisationIdsByUser,
  getMessageAudience,
  isInAudience,
  withoutPeople,
  type MessageAudience,
} from "./benchService.js";
import { openThread, createDmMessage, getThreadById, mayDirectMessage, DM_NOT_ALLOWED } from "./benchDmService.js";
import { blockedBy } from "./benchBlockService.js";
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
/** Whom each connected person has blocked, read before any of their sockets joins a room; kept current by {@link noteBlock}. */
const blocks = new Map<number, Set<number>>();

let io: Server;

const CLOSE_GRACE_MS = 1_000;
const SERVER_STOPPING = "server shutting down"; // socket.io's own disconnect reason

function addUserSocket(userId: number) {
  userSocketCount.set(userId, (userSocketCount.get(userId) ?? 0) + 1);
}

/** Returns true if user has no more sockets (truly disconnected) */
function removeUserSocket(userId: number): boolean {
  const count = (userSocketCount.get(userId) ?? 1) - 1;
  if (count <= 0) {
    userSocketCount.delete(userId);
    userProfiles.delete(userId);
    blocks.delete(userId);
    return true;
  }
  userSocketCount.set(userId, count);
  return false;
}

/**
 * Reads whom this person blocked, then puts the socket in Everyone and its own room. Until then it is in no room, so nothing
 * reaches it unfiltered.
 */
async function enter(socket: Socket, userId: number) {
  const blocked = await blockedBy(userId);
  if (!userSocketCount.has(userId)) return; // gone before the read came back
  // Merged: a block made while this was read is already in. One lifted meanwhile stays until they reconnect, hidden rather than shown.
  const mine = blocks.get(userId) ?? new Set<number>();
  for (const id of blocked) mine.add(id);
  blocks.set(userId, mine);
  socket.join("bench:everyone");
  socket.join(`bench:user_${userId}`);
}

/** Reads who this is, then shows them to everyone and to the kitchens they have joined meanwhile. */
async function announce(socket: Socket, userId: number, entered: Promise<unknown>) {
  const profile: UserProfile = { userId, userName: "Chef", userPhotoPath: null };
  try {
    const [u] = await db
      .select({ userName: userTable.userName, userPhotoPath: userTable.userPhotoPath })
      .from(userTable)
      .where(eq(userTable.userId, userId))
      .limit(1);
    if (u) {
      profile.userName = u.userName;
      profile.userPhotoPath = u.userPhotoPath;
    }
  } catch {
    // Use defaults
  }
  await entered;
  if (!userSocketCount.has(userId)) return; // gone before the read came back
  userProfiles.set(userId, profile);
  void sendEveryonePresence();
  for (const channelKey of kitchensOf(socket)) broadcastPresence(channelKey);
}

/** Every device of everyone connected who blocked this person. */
function blockerRooms(userId: number): string[] {
  return [...blocks].filter(([, blocked]) => blocked.has(userId)).map(([blocker]) => `bench:user_${blocker}`);
}

/** Sends the rooms `payloadFor` of no one, except to a person who blocked someone: each of their devices gets `payloadFor` of whom they blocked. */
function emitEach(rooms: string[], event: string, payloadFor: (hidden: ReadonlySet<number>) => unknown) {
  const blockers = [...blocks].filter(([, blocked]) => blocked.size > 0);
  io.to(rooms).except(blockers.map(([blocker]) => `bench:user_${blocker}`)).emit(event, payloadFor(new Set()));
  for (const [blocker, blocked] of blockers) {
    for (const socketId of io.sockets.adapter.rooms.get(`bench:user_${blocker}`) ?? []) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && rooms.some((room) => socket.rooms.has(room))) socket.emit(event, payloadFor(blocked));
    }
  }
}

/** The rooms of a stored message's DM or channel. */
function audienceRooms(audience: MessageAudience): string[] {
  return audience.userAId !== null ? [`bench:user_${audience.userAId}`, `bench:user_${audience.userBId}`] : [`bench:${audience.channelKey}`];
}

/** Tells a stored message's DM or channel; `authorId`'s blockers are left out. */
function broadcastToAudience(audience: MessageAudience, event: string, payload: Record<string, unknown>, authorId?: number) {
  io.to(audienceRooms(audience)).except(authorId === undefined ? [] : blockerRooms(authorId)).emit(event, payload);
}

/** The kitchens' own channels this socket is in */
function kitchensOf(socket: Socket): string[] {
  return [...socket.rooms].filter((room) => room.startsWith("bench:org_")).map((room) => room.slice("bench:".length));
}

/** The people with a socket in this room now */
function getRoomUsers(channelKey: string): UserProfile[] {
  const users = new Map<number, UserProfile>();
  for (const socketId of io.sockets.adapter.rooms.get(`bench:${channelKey}`) ?? []) {
    const profile = userProfiles.get(io.sockets.sockets.get(socketId)?.data.user.sub);
    if (profile) users.set(profile.userId, profile);
  }
  return Array.from(users.values());
}

/** Broadcast presence to everyone in an organisation or DM room: who is in it; never whom the viewer blocked */
function broadcastPresence(channelKey: string) {
  const users = getRoomUsers(channelKey);
  logger.debug({ channelKey, userCount: users.length, userIds: users.map(u => u.userId) }, "Bench: broadcasting presence");
  emitEach([`bench:${channelKey}`], "bench:presence:update", (hidden) => ({ channelKey, users: users.filter((u) => !hidden.has(u.userId)) }));
}

/**
 * A block made or lifted: from now on this person's devices are sent accordingly, and their presence lists are sent again.
 * What is on their screen already the client takes away itself.
 */
export function noteBlock(userId: number, otherId: number, blocked: boolean): void {
  if (!io || !userSocketCount.has(userId)) return; // not connected: read when they connect
  const mine = blocks.get(userId) ?? new Set<number>();
  blocks.set(userId, mine);
  if (blocked) mine.add(otherId);
  else mine.delete(otherId);
  const rooms = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user.sub !== userId) continue;
    for (const room of socket.rooms) if (room === "bench:everyone" || room.startsWith("bench:org_")) rooms.add(room);
  }
  for (const room of rooms) {
    if (room === "bench:everyone") void sendEveryonePresence();
    else broadcastPresence(room.slice("bench:".length));
  }
}

/** A message a moderator hid: gone for everyone who has it on screen, as a deletion is. */
export async function announceHidden(messageId: string): Promise<void> {
  if (!io) return;
  const audience = await getMessageAudience(messageId);
  if (audience) broadcastToAudience(audience, "bench:message:deleted", { messageId });
}

let everyoneRound = 0;

/**
 * Everyone's list is each viewer's own: the people online who share an organisation with them, and themselves; never whom they blocked.
 * Memberships are read at each send, so a kitchen joined or left shows by the next one. Sent to the sockets in Everyone, or to one.
 */
async function sendEveryonePresence(only?: Socket) {
  const round = only ? everyoneRound : ++everyoneRound;
  try {
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get("bench:everyone") ?? [])].flatMap((id) => io.sockets.sockets.get(id) ?? []);
    if (sockets.length === 0) return;
    const online = Array.from(userProfiles.values());
    const kitchens = await getOrganisationIdsByUser(online.map((u) => u.userId));
    if (!only && round !== everyoneRound) return; // a later send to everyone, made from newer state, may already be out
    for (const socket of sockets) {
      const viewer = socket.data.user.sub as number;
      const mine = kitchens.get(viewer) ?? [];
      const hidden = blocks.get(viewer);
      const users = online.filter((u) => u.userId === viewer || (!hidden?.has(u.userId) && (kitchens.get(u.userId) ?? []).some((id) => mine.includes(id))));
      socket.emit("bench:presence:update", { channelKey: "everyone", users });
    }
  } catch (err) {
    logger.warn({ err }, "Bench: Everyone presence not sent");
  }
}

/** A removed member's sockets stop receiving the organisation's channel. Membership is otherwise only checked when they join it. */
export function evictFromOrganisationRoom(userId: number, organisationId: number): void {
  if (!io) return; // scripts and tests that never start the socket server
  io.in(`bench:user_${userId}`).socketsLeave(`bench:org_${organisationId}`);
  broadcastPresence(`org_${organisationId}`);
  void sendEveryonePresence();
}

/** May this user receive this room? Everyone, an organisation they belong to, a DM thread they are in; nothing else. */
async function canJoin(channelKey: string, userId: number): Promise<boolean> {
  if (channelKey === "everyone") return true;
  const [, kind, digits] = /^(org|dm)_([1-9]\d{0,8})$/.exec(channelKey) ?? [];
  if (kind === "org") return (await getUserOrganisationIds(userId)).includes(Number(digits));
  if (kind === "dm") {
    const thread = await getThreadById(Number(digits));
    return thread !== null && (thread.userAId === userId || thread.userBId === userId);
  }
  return false;
}

/**
 * Initialize Socket.io on the given HTTP server.
 * Called once from index.ts during startup.
 *
 * Returns the function that ends every connection, so the HTTP server can finish closing. A client sees a dropped
 * connection and comes back by itself; one that does not answer is cut off after {@link CLOSE_GRACE_MS}.
 */
export function initBenchSocket(httpServer: HttpServer): () => void {
  io = new Server(httpServer, {
    cors: {
      origin: CLIENT_URL,
      credentials: true,
    },
    path: "/socket.io",
  });

  // Once upgraded, a connection is no longer one the HTTP server closes itself.
  const upgraded = new Set<Duplex>();
  httpServer.on("upgrade", (_req, socket) => {
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
  });

  // ── Auth middleware ────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token = extractHandshakeToken(socket.handshake);
      if (!token) return next(new Error("AUTH_REQUIRED"));

      const payload = verifyAccessToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("AUTH_INVALID"));
    }
  });

  // ── Connection handler ────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    const userId = socket.data.user.sub as number;
    logger.info({ userId, socketId: socket.id }, "Bench: user connected");
    const userName = () => userProfiles.get(userId)?.userName ?? "Chef";

    // Register user (ref-counted — multiple sockets per user are fine)
    addUserSocket(userId);

    // Joins the "everyone" room and personal DM room once whom they blocked is known.
    // Nothing may be awaited before the handlers below: what a client sends as it connects would find none.
    const ready = enter(socket, userId).catch((err) => {
      logger.error({ err, userId }, "Bench: reading blocks failed");
      socket.disconnect(true); // a socket whose blocks are unknown would receive unfiltered
    });
    void announce(socket, userId, ready);

    // ── Join channel ──────────────────────────────────────
    onBenchEvent(socket, "bench:join", async ({ channelKey }) => {
      try {
        await ready; // a room joined before whom they blocked is known would deliver unfiltered
        if (socket.disconnected) return;
        if (!(await canJoin(channelKey, userId))) {
          socket.emit("bench:error", { error: "You cannot join this channel", code: "FORBIDDEN" });
          return;
        }
        socket.join(`bench:${channelKey}`);
        if (channelKey === "everyone") void sendEveryonePresence(socket);
        else broadcastPresence(channelKey);
        logger.debug({ userId, channelKey }, "Bench: joined channel");
      } catch (err) {
        logger.error({ err, userId, channelKey }, "Bench: join failed");
        socket.emit("bench:error", { error: "Failed to join channel" });
      }
    });

    // ── Leave channel ─────────────────────────────────────
    onBenchEvent(socket, "bench:leave", ({ channelKey }) => {
      socket.leave(`bench:${channelKey}`);
      if (channelKey !== "everyone") broadcastPresence(channelKey);
    });

    // ── Send message ──────────────────────────────────────
    onBenchEvent(socket, "bench:message", async (data) => {
      try {
        // Input validation
        if (!data.body.trim() && data.messageType !== "recipe_share") return;
        if (data.body.length > 5000) {
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

        const { replay, ...message } = await createMessage(
          channel.channelId,
          userId,
          data.body.trim(),
          data.messageType ?? "text",
          data.recipeId ?? undefined,
          data.messageId,
        );
        const sent = { ...message, channelKey: data.channelKey };
        if (replay) return answerReplay("bench:message:new", sent);

        // Broadcast to the channel room, but to nobody who blocked the sender
        io.to(`bench:${data.channelKey}`).except(blockerRooms(userId)).emit("bench:message:new", sent);

        // Clear typing indicator
        clearTyping(data.channelKey, userId);
      } catch (err) {
        logger.error({ err, userId }, "Bench: message send failed");
        answerNotSent(err);
      }
    });

    // ── Helpers: what the sender of a post is told ────────
    /** The server already has the post: only its sender is told, and what was deleted since stays deleted. */
    function answerReplay(event: "bench:message:new" | "bench:dm:new", message: { messageId: string; deletedInd: boolean }) {
      if (message.deletedInd) socket.emit("bench:message:deleted", { messageId: message.messageId });
      else socket.emit(event, message);
    }

    function answerNotSent(err: unknown) {
      socket.emit("bench:error", err instanceof AppError ? { error: err.message, code: err.code } : { error: "Failed to send message" });
    }

    // ── Typing indicator ──────────────────────────────────
    onBenchEvent(socket, "bench:typing", async ({ channelKey }) => {
      if (!socket.rooms.has(`bench:${channelKey}`)) return;
      if (channelKey.startsWith("org_")) {
        const orgId = parseInt(channelKey.replace("org_", ""), 10);
        if (isNaN(orgId)) return;
        const userOrgIds = await getUserOrganisationIds(userId);
        if (!userOrgIds.includes(orgId)) return;
      }
      setTyping(channelKey, userId, userName());
      socket.to(`bench:${channelKey}`).except(blockerRooms(userId)).emit("bench:typing", { channelKey, userId, userName: userName() });
    });

    // ── Reactions ─────────────────────────────────────────
    onBenchEvent(socket, "bench:reaction:add", async ({ messageId, emoji }) => {
      try {
        const audience = await getMessageAudience(messageId);
        if (!audience || !(await isInAudience(audience, userId))) return;
        await addReaction(messageId, userId, emoji);
        const reactions = await getReactions(messageId);
        emitEach(audienceRooms(audience), "bench:reaction:updated", (hidden) => ({ messageId, reactions: withoutPeople(reactions, hidden) }));
      } catch (err) {
        logger.warn({ err, messageId, emoji }, "Bench: reaction add failed");
      }
    });

    onBenchEvent(socket, "bench:reaction:remove", async ({ messageId, emoji }) => {
      try {
        const audience = await getMessageAudience(messageId);
        if (!audience || !(await isInAudience(audience, userId))) return;
        await removeReaction(messageId, userId, emoji);
        const reactions = await getReactions(messageId);
        emitEach(audienceRooms(audience), "bench:reaction:updated", (hidden) => ({ messageId, reactions: withoutPeople(reactions, hidden) }));
      } catch (err) {
        logger.warn({ err, messageId, emoji }, "Bench: reaction remove failed");
      }
    });

    // ── Delete message ────────────────────────────────────
    onBenchEvent(socket, "bench:message:delete", async ({ messageId }) => {
      try {
        const isAdmin = (socket.data.user.roles as string[] ?? []).includes("Administrator");
        const deleted = await softDeleteMessage(messageId, userId, isAdmin);
        const audience = deleted ? await getMessageAudience(messageId) : null;
        if (audience) broadcastToAudience(audience, "bench:message:deleted", { messageId });
      } catch (err) {
        logger.warn({ err, messageId }, "Bench: message delete failed");
      }
    });

    // ── Edit message ──────────────────────────────────────
    onBenchEvent(socket, "bench:message:edit", async ({ messageId, newBody }) => {
      try {
        if (!newBody.trim() || newBody.length > 5000) {
          socket.emit("bench:error", { error: "Invalid message" });
          return;
        }
        // A former member may not put new text into the organisation's channel.
        const audience = await getMessageAudience(messageId);
        if (!audience || !(await isInAudience(audience, userId))) return;
        const edited = await editMessage(messageId, userId, newBody.trim());
        if (edited) {
          broadcastToAudience(audience, "bench:message:edited", { messageId, newBody: newBody.trim(), editedInd: true }, userId);
        }
      } catch (err) {
        logger.warn({ err, messageId }, "Bench: message edit failed");
      }
    });

    // ── Direct Messages ────────────────────────────────────
    onBenchEvent(socket, "bench:dm:send", async ({ recipientId, body, messageId }) => {
      try {
        if (!body.trim() || body.length > 5000) return;
        const thread = await openThread(userId, recipientId);
        if (!thread) {
          socket.emit("bench:error", DM_NOT_ALLOWED);
          return;
        }
        const { replay, ...message } = await createDmMessage(thread.dmThreadId, userId, body.trim(), messageId);
        if (replay) return answerReplay("bench:dm:new", message);
        // Send to both sender and recipient
        io.to(`bench:user_${userId}`).emit("bench:dm:new", message);
        io.to(`bench:user_${recipientId}`).emit("bench:dm:new", message);
      } catch (err) {
        logger.error({ err, userId, recipientId }, "Bench: DM send failed");
        answerNotSent(err);
      }
    });

    onBenchEvent(socket, "bench:dm:typing", async ({ recipientId }) => {
      if (!(await mayDirectMessage(userId, recipientId))) {
        socket.emit("bench:error", DM_NOT_ALLOWED);
        return;
      }
      io.to(`bench:user_${recipientId}`).emit("bench:dm:typing", { userId, userName: userName() });
    });

    // ── Presence heartbeat (answers the asker with a fresh Everyone list) ───
    onBenchEvent(socket, "bench:presence:heartbeat", () => {
      if (socket.rooms.has("bench:everyone")) void sendEveryonePresence(socket);
    });

    // ── Disconnect ────────────────────────────────────────
    let left: string[] = [];
    onBenchEvent(socket, "disconnecting", () => {
      left = kitchensOf(socket); // "disconnect" comes after it has left every room
    });

    onBenchEvent(socket, "disconnect", (reason) => {
      logger.info({ userId, socketId: socket.id }, "Bench: user disconnected");
      const fullyGone = removeUserSocket(userId);
      // Only broadcast presence change if user has NO remaining sockets.
      // During transport upgrades (polling → websocket), the old socket
      // disconnects but a new one connects immediately — count stays > 0.
      if (reason !== SERVER_STOPPING) {
        if (fullyGone) void sendEveryonePresence();
        for (const channelKey of left) broadcastPresence(channelKey);
      }
      // Clear typing
      for (const [channelKey] of typingMap) {
        clearTyping(channelKey, userId);
      }
    });
  });

  logger.info("The Bench Socket.io initialized");

  return () => {
    void io.close();
    setTimeout(() => {
      for (const socket of upgraded) socket.destroy();
      httpServer.closeIdleConnections(); // kept alive after an answer that was still on its way
    }, CLOSE_GRACE_MS).unref();
  };
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
