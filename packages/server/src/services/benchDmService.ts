/**
 * @module services/benchDmService
 *
 * Database operations for The Bench direct messages.
 */

import pino from "pino";
import { db } from "../db/index.js";
import { benchDmThread, benchMessage, user } from "../db/schema.js";
import { eq, and, or, desc, lt, exists, notInArray } from "drizzle-orm";
import { insertPost, sharesOrganisation } from "./benchService.js";
import { blockedBy, isBlockedEitherWay } from "./benchBlockService.js";

const logger = pino({ name: "benchDmService" });

// ---------------------------------------------------------------------------
// Thread operations
// ---------------------------------------------------------------------------

/** The answer when a direct message may not be sent: HTTP 403 and `bench:error` alike. */
export const DM_NOT_ALLOWED = {
  error: "You can message people in your kitchen, and people you already have a conversation with.",
  code: "DM_NOT_ALLOWED",
} as const;

/** The thread between two people, if there is one. */
async function findThread(userIdA: number, userIdB: number) {
  const [existing] = await db
    .select()
    .from(benchDmThread)
    .where(and(eq(benchDmThread.userAId, Math.min(userIdA, userIdB)), eq(benchDmThread.userBId, Math.max(userIdA, userIdB))))
    .limit(1);
  return existing ?? null;
}

/**
 * The thread between two people if they have written in it: one with no message (one could be opened with anybody
 * before these rules) is not a conversation, as the thread list does not show it either.
 */
async function findConversation(userIdA: number, userIdB: number) {
  const [found] = await db
    .select()
    .from(benchDmThread)
    .where(
      and(
        eq(benchDmThread.userAId, Math.min(userIdA, userIdB)),
        eq(benchDmThread.userBId, Math.max(userIdA, userIdB)),
        exists(
          db
            .select({ one: benchMessage.messageId })
            .from(benchMessage)
            .where(and(eq(benchMessage.dmThreadId, benchDmThread.dmThreadId), eq(benchMessage.deletedInd, false))),
        ),
      ),
    )
    .limit(1);
  return found ?? null;
}

/**
 * Who may write to whom: people who share an organisation, and two people who already have a conversation (even if they no longer share one);
 * never two people where either has blocked the other.
 */
export async function mayDirectMessage(senderId: number, recipientId: number): Promise<boolean> {
  if (await isBlockedEitherWay(senderId, recipientId)) return false;
  return (await findConversation(senderId, recipientId)) !== null || sharesOrganisation(senderId, recipientId);
}

/** The thread between two people, made if they may have one; null otherwise (blocked, no shared kitchen, or no such person: one answer for all). */
export async function openThread(senderId: number, recipientId: number) {
  if (await isBlockedEitherWay(senderId, recipientId)) return null;
  const existing = await findConversation(senderId, recipientId);
  if (existing) return existing;
  return (await sharesOrganisation(senderId, recipientId)) ? getOrCreateThread(senderId, recipientId) : null;
}

export async function getOrCreateThread(userIdA: number, userIdB: number) {
  // Always store lower userId as user_a to ensure uniqueness
  const userAId = Math.min(userIdA, userIdB);
  const userBId = Math.max(userIdA, userIdB);

  const existing = await findThread(userAId, userBId);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(benchDmThread)
      .values({ userAId, userBId })
      .onConflictDoNothing()
      .returning();

    if (created) {
      logger.info({ userAId, userBId, dmThreadId: created.dmThreadId }, "DM thread created");
      return created;
    }
  } catch {
    // Concurrent insert — fall through
  }

  // Re-fetch
  const [refetched] = await db
    .select()
    .from(benchDmThread)
    .where(and(eq(benchDmThread.userAId, userAId), eq(benchDmThread.userBId, userBId)))
    .limit(1);
  return refetched!;
}

export interface DmThreadWithPreview {
  dmThreadId: number;
  otherUserId: number;
  otherUserName: string;
  otherUserPhotoPath: string | null;
  lastMessage: string | null;
  lastMessageAt: Date;
}

/** A thread with someone this person blocked is left out. */
export async function getThreadsForUser(userId: number): Promise<DmThreadWithPreview[]> {
  const hidden = await blockedBy(userId);
  const threads = await db
    .select()
    .from(benchDmThread)
    .where(or(eq(benchDmThread.userAId, userId), eq(benchDmThread.userBId, userId)))
    .orderBy(desc(benchDmThread.lastMessageAt));

  const results: DmThreadWithPreview[] = [];
  for (const t of threads) {
    const otherUserId = t.userAId === userId ? t.userBId : t.userAId;
    if (hidden.includes(otherUserId)) continue;

    const [otherUser] = await db
      .select({ userName: user.userName, userPhotoPath: user.userPhotoPath })
      .from(user)
      .where(eq(user.userId, otherUserId))
      .limit(1);

    // Get last message preview
    const [lastMsg] = await db
      .select({ messageBody: benchMessage.messageBody })
      .from(benchMessage)
      .where(and(eq(benchMessage.dmThreadId, t.dmThreadId), eq(benchMessage.deletedInd, false)))
      .orderBy(desc(benchMessage.createdDttm))
      .limit(1);

    // Skip threads with no remaining (non-deleted) messages
    if (!lastMsg) continue;

    results.push({
      dmThreadId: t.dmThreadId,
      otherUserId,
      otherUserName: otherUser?.userName ?? "Chef",
      otherUserPhotoPath: otherUser?.userPhotoPath ?? null,
      lastMessage: lastMsg?.messageBody ?? null,
      lastMessageAt: t.lastMessageAt,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// DM Messages
// ---------------------------------------------------------------------------

export interface DmMessage {
  messageId: string;
  dmThreadId: number;
  userId: number;
  userName: string;
  userPhotoPath: string | null;
  messageBody: string;
  editedInd: boolean;
  deletedInd: boolean;
  createdDttm: Date;
}

/** `viewerId`: the messages of someone they blocked are left out. */
export async function getDmMessages(
  threadId: number,
  options: { before?: string; limit?: number; viewerId?: number } = {},
): Promise<DmMessage[]> {
  const limit = Math.min(options.limit ?? 50, 100);
  const hidden = options.viewerId === undefined ? [] : await blockedBy(options.viewerId);

  const conditions = [
    eq(benchMessage.dmThreadId, threadId),
    eq(benchMessage.deletedInd, false),
  ];
  if (hidden.length > 0) conditions.push(notInArray(benchMessage.userId, hidden));
  if (options.before) {
    conditions.push(lt(benchMessage.createdDttm, new Date(options.before)));
  }

  const messages = await db
    .select({
      messageId: benchMessage.messageId,
      dmThreadId: benchMessage.dmThreadId,
      userId: benchMessage.userId,
      userName: user.userName,
      userPhotoPath: user.userPhotoPath,
      messageBody: benchMessage.messageBody,
      editedInd: benchMessage.editedInd,
      deletedInd: benchMessage.deletedInd,
      createdDttm: benchMessage.createdDttm,
    })
    .from(benchMessage)
    .leftJoin(user, eq(benchMessage.userId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(benchMessage.createdDttm))
    .limit(limit);

  return messages.reverse().map((m) => ({
    messageId: m.messageId,
    dmThreadId: m.dmThreadId ?? threadId,
    userId: m.userId,
    userName: m.userName ?? "Chef",
    userPhotoPath: m.userPhotoPath ?? null,
    messageBody: m.messageBody,
    editedInd: m.editedInd,
    deletedInd: m.deletedInd,
    createdDttm: m.createdDttm,
  }));
}

export async function createDmMessage(
  threadId: number,
  userId: number,
  body: string,
  messageId?: string,
): Promise<DmMessage & { replay: boolean }> {
  const { row: msg, replay } = await insertPost({
    messageId,
    dmThreadId: threadId,
    userId,
    messageBody: body,
    messageType: "text",
  });

  // Update thread's last_message_at
  if (!replay) {
    await db
      .update(benchDmThread)
      .set({ lastMessageAt: new Date() })
      .where(eq(benchDmThread.dmThreadId, threadId));
  }

  const [u] = await db
    .select({ userName: user.userName, userPhotoPath: user.userPhotoPath })
    .from(user)
    .where(eq(user.userId, userId))
    .limit(1);

  return {
    messageId: msg.messageId,
    dmThreadId: threadId,
    userId: msg.userId,
    userName: u?.userName ?? "Chef",
    userPhotoPath: u?.userPhotoPath ?? null,
    messageBody: msg.messageBody,
    editedInd: msg.editedInd,
    deletedInd: msg.deletedInd,
    createdDttm: msg.createdDttm,
    replay,
  };
}

export async function getThreadById(threadId: number) {
  const [t] = await db
    .select()
    .from(benchDmThread)
    .where(eq(benchDmThread.dmThreadId, threadId))
    .limit(1);
  return t ?? null;
}
