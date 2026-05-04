/**
 * @module services/benchService
 *
 * Database CRUD for The Bench community chat.
 * Pure data layer — no socket logic here.
 */

import pino from "pino";
import { db } from "../db/index.js";
import {
  benchChannel,
  benchMessage,
  benchReaction,
  benchMention,
  benchPin,
  user,
  userOrganisation,
  organisation,
  recipe,
} from "../db/schema.js";
import { eq, and, desc, sql, lt, inArray } from "drizzle-orm";

const logger = pino({ name: "benchService" });

// ---------------------------------------------------------------------------
// Channel operations
// ---------------------------------------------------------------------------

export async function getChannelByKey(channelKey: string) {
  const [ch] = await db
    .select()
    .from(benchChannel)
    .where(eq(benchChannel.channelKey, channelKey))
    .limit(1);
  return ch ?? null;
}

export async function getOrCreateOrgChannel(organisationId: number, organisationName: string) {
  const key = `org_${organisationId}`;
  const existing = await getChannelByKey(key);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(benchChannel)
      .values({
        channelKey: key,
        channelName: organisationName,
        channelType: "organisation",
        organisationId,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      logger.info({ channelKey: key, organisationName }, "Bench: org channel created");
      return created;
    }
  } catch {
    // Concurrent insert — fall through to re-fetch
  }

  // Re-fetch the row created by the concurrent call
  return (await getChannelByKey(key))!;
}

export async function getUserChannels(userId: number) {
  // Always include "everyone"
  const channels = await db
    .select()
    .from(benchChannel)
    .where(eq(benchChannel.channelKey, "everyone"));

  // Add user's org channels (auto-create if missing)
  const orgIds = await getUserOrganisationIds(userId);
  if (orgIds.length > 0) {
    for (const orgId of orgIds) {
      let orgChannel = await getChannelByKey(`org_${orgId}`);
      if (!orgChannel) {
        // Auto-create the org channel — look up org name
        const [org] = await db
          .select({ organisationName: organisation.organisationName })
          .from(organisation)
          .where(eq(organisation.organisationId, orgId))
          .limit(1);
        if (org) {
          orgChannel = await getOrCreateOrgChannel(orgId, org.organisationName);
        }
      }
      if (orgChannel) channels.push(orgChannel);
    }
  }

  return channels;
}

export async function getUserOrganisationIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ organisationId: userOrganisation.organisationId })
    .from(userOrganisation)
    .where(eq(userOrganisation.userId, userId));
  return rows.map((r) => r.organisationId);
}

// ---------------------------------------------------------------------------
// Channel banner
// ---------------------------------------------------------------------------

export async function updateChannelBanner(channelKey: string, banner: string) {
  await db
    .update(benchChannel)
    .set({ channelBanner: banner })
    .where(eq(benchChannel.channelKey, channelKey));
}

// ---------------------------------------------------------------------------
// Message operations
// ---------------------------------------------------------------------------

export interface BenchMessageWithUser {
  messageId: string;
  channelId: number | null;
  userId: number;
  userName: string;
  userPhotoPath: string | null;
  messageBody: string;
  messageType: string;
  recipeId: string | null;
  recipeTitle?: string | null;
  recipeImageUrl?: string | null;
  recipeSlug?: string | null;
  editedInd: boolean;
  deletedInd: boolean;
  createdDttm: Date;
  reactions: { emoji: string; count: number; userIds: number[] }[];
}

export async function createMessage(
  channelId: number,
  userId: number,
  body: string,
  messageType: "text" | "recipe_share" = "text",
  recipeId?: string,
): Promise<BenchMessageWithUser> {
  const [msg] = await db
    .insert(benchMessage)
    .values({
      channelId,
      userId,
      messageBody: body,
      messageType,
      recipeId: recipeId ?? null,
    })
    .returning();

  // Fetch user info for the response
  const [u] = await db
    .select({ userName: user.userName, userPhotoPath: user.userPhotoPath })
    .from(user)
    .where(eq(user.userId, userId))
    .limit(1);

  // Fetch recipe info if recipe_share
  let recipeInfo: { title: string; imageUrl: string | null; slug: string | null } | null = null;
  if (messageType === "recipe_share" && recipeId) {
    const [r] = await db
      .select({ title: recipe.title, imageUrl: recipe.imageUrl, slug: recipe.slug })
      .from(recipe)
      .where(eq(recipe.recipeId, recipeId))
      .limit(1);
    recipeInfo = r ?? null;
  }

  return {
    messageId: msg.messageId,
    channelId: msg.channelId,
    userId: msg.userId,
    userName: u?.userName ?? "Chef",
    userPhotoPath: u?.userPhotoPath ?? null,
    messageBody: msg.messageBody,
    messageType: msg.messageType,
    recipeId: msg.recipeId,
    recipeTitle: recipeInfo?.title,
    recipeImageUrl: recipeInfo?.imageUrl,
    recipeSlug: recipeInfo?.slug,
    editedInd: msg.editedInd,
    deletedInd: msg.deletedInd,
    createdDttm: msg.createdDttm,
    reactions: [],
  };
}

export async function getMessages(
  channelId: number,
  options: { before?: string; limit?: number } = {},
): Promise<BenchMessageWithUser[]> {
  const limit = Math.min(options.limit ?? 50, 100);

  const conditions = [
    eq(benchMessage.channelId, channelId),
    eq(benchMessage.deletedInd, false),
  ];
  if (options.before) {
    // Fetch messages older than the given timestamp
    conditions.push(lt(benchMessage.createdDttm, new Date(options.before)));
  }

  const messages = await db
    .select({
      messageId: benchMessage.messageId,
      channelId: benchMessage.channelId,
      userId: benchMessage.userId,
      userName: user.userName,
      userPhotoPath: user.userPhotoPath,
      messageBody: benchMessage.messageBody,
      messageType: benchMessage.messageType,
      recipeId: benchMessage.recipeId,
      editedInd: benchMessage.editedInd,
      deletedInd: benchMessage.deletedInd,
      createdDttm: benchMessage.createdDttm,
    })
    .from(benchMessage)
    .leftJoin(user, eq(benchMessage.userId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(benchMessage.createdDttm))
    .limit(limit);

  // Fetch reactions for these messages
  const messageIds = messages.map((m) => m.messageId);
  const reactionsMap = await getReactionsForMessages(messageIds);

  // Fetch recipe info for recipe_share messages
  const recipeIds = messages
    .filter((m) => m.messageType === "recipe_share" && m.recipeId)
    .map((m) => m.recipeId!);

  const recipeMap = new Map<string, { title: string; imageUrl: string | null; slug: string | null }>();
  if (recipeIds.length > 0) {
    for (const rid of recipeIds) {
      const [r] = await db
        .select({ title: recipe.title, imageUrl: recipe.imageUrl, slug: recipe.slug })
        .from(recipe)
        .where(eq(recipe.recipeId, rid))
        .limit(1);
      if (r) recipeMap.set(rid, r);
    }
  }

  // Reverse to chronological order (oldest first) for display
  return messages.reverse().map((m) => ({
    messageId: m.messageId,
    channelId: m.channelId,
    userId: m.userId,
    userName: m.userName ?? "Chef",
    userPhotoPath: m.userPhotoPath ?? null,
    messageBody: m.messageBody,
    messageType: m.messageType,
    recipeId: m.recipeId,
    recipeTitle: recipeMap.get(m.recipeId ?? "")?.title,
    recipeImageUrl: recipeMap.get(m.recipeId ?? "")?.imageUrl,
    recipeSlug: recipeMap.get(m.recipeId ?? "")?.slug,
    editedInd: m.editedInd,
    deletedInd: m.deletedInd,
    createdDttm: m.createdDttm,
    reactions: reactionsMap.get(m.messageId) ?? [],
  }));
}

export async function editMessage(messageId: string, userId: number, newBody: string): Promise<boolean> {
  const result = await db
    .update(benchMessage)
    .set({ messageBody: newBody, editedInd: true, updatedDttm: new Date() })
    .where(and(eq(benchMessage.messageId, messageId), eq(benchMessage.userId, userId)))
    .returning({ messageId: benchMessage.messageId });
  return result.length > 0;
}

/**
 * Soft-delete a message. If isAdmin is true, any message can be deleted
 * (admins are moderators). Otherwise only the message owner can delete.
 */
export async function softDeleteMessage(messageId: string, userId: number, isAdmin = false): Promise<boolean> {
  const conditions = [eq(benchMessage.messageId, messageId)];
  if (!isAdmin) {
    conditions.push(eq(benchMessage.userId, userId));
  }
  const result = await db
    .update(benchMessage)
    .set({ deletedInd: true, updatedDttm: new Date() })
    .where(and(...conditions))
    .returning({ messageId: benchMessage.messageId });
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Reaction operations
// ---------------------------------------------------------------------------

export async function addReaction(messageId: string, userId: number, emoji: string) {
  await db
    .insert(benchReaction)
    .values({ messageId, userId, emoji })
    .onConflictDoNothing();
}

export async function removeReaction(messageId: string, userId: number, emoji: string) {
  await db
    .delete(benchReaction)
    .where(and(
      eq(benchReaction.messageId, messageId),
      eq(benchReaction.userId, userId),
      eq(benchReaction.emoji, emoji),
    ));
}

export async function getReactions(messageId: string) {
  const rows = await db
    .select({
      emoji: benchReaction.emoji,
      userId: benchReaction.userId,
    })
    .from(benchReaction)
    .where(eq(benchReaction.messageId, messageId));

  // Group by emoji
  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    if (!grouped.has(r.emoji)) grouped.set(r.emoji, []);
    grouped.get(r.emoji)!.push(r.userId);
  }
  return Array.from(grouped.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
  }));
}

async function getReactionsForMessages(messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, { emoji: string; count: number; userIds: number[] }[]>();

  const rows = await db
    .select({
      messageId: benchReaction.messageId,
      emoji: benchReaction.emoji,
      userId: benchReaction.userId,
    })
    .from(benchReaction)
    .where(inArray(benchReaction.messageId, messageIds));

  const map = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (!map.has(r.messageId)) map.set(r.messageId, new Map());
    const emojiMap = map.get(r.messageId)!;
    if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, []);
    emojiMap.get(r.emoji)!.push(r.userId);
  }

  const result = new Map<string, { emoji: string; count: number; userIds: number[] }[]>();
  for (const [mid, emojiMap] of map) {
    result.set(mid, Array.from(emojiMap.entries()).map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      userIds,
    })));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mention operations
// ---------------------------------------------------------------------------

export async function getUnreadMentions(userId: number) {
  const rows = await db
    .select({
      mentionId: benchMention.mentionId,
      messageId: benchMention.messageId,
    })
    .from(benchMention)
    .where(and(eq(benchMention.mentionedUserId, userId), eq(benchMention.readInd, false)));
  return { count: rows.length, mentions: rows };
}

export async function markMentionsRead(userId: number, channelId?: number) {
  const conditions = [eq(benchMention.mentionedUserId, userId), eq(benchMention.readInd, false)];
  await db.update(benchMention).set({ readInd: true }).where(and(...conditions));
}

// ---------------------------------------------------------------------------
// Pin operations
// ---------------------------------------------------------------------------

export async function pinMessage(messageId: string, channelId: number, pinnedBy: number) {
  await db.insert(benchPin).values({ messageId, channelId, pinnedBy }).onConflictDoNothing();
}

export async function unpinMessage(messageId: string) {
  await db.delete(benchPin).where(eq(benchPin.messageId, messageId));
}

export async function getPinnedMessages(channelId: number) {
  const pins = await db
    .select({
      pinId: benchPin.pinId,
      messageId: benchPin.messageId,
      pinnedBy: benchPin.pinnedBy,
      createdDttm: benchPin.createdDttm,
      messageBody: benchMessage.messageBody,
      userId: benchMessage.userId,
      userName: user.userName,
    })
    .from(benchPin)
    .leftJoin(benchMessage, eq(benchPin.messageId, benchMessage.messageId))
    .leftJoin(user, eq(benchMessage.userId, user.userId))
    .where(eq(benchPin.channelId, channelId))
    .orderBy(desc(benchPin.createdDttm));
  return pins;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchMessages(
  channelId: number,
  query: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = Math.min(options.limit ?? 20, 50);
  const term = `%${query}%`;

  const results = await db
    .select({
      messageId: benchMessage.messageId,
      messageBody: benchMessage.messageBody,
      userId: benchMessage.userId,
      userName: user.userName,
      createdDttm: benchMessage.createdDttm,
    })
    .from(benchMessage)
    .leftJoin(user, eq(benchMessage.userId, user.userId))
    .where(and(
      eq(benchMessage.channelId, channelId),
      eq(benchMessage.deletedInd, false),
      sql`${benchMessage.messageBody} ILIKE ${term}`,
    ))
    .orderBy(desc(benchMessage.createdDttm))
    .limit(limit)
    .offset(options.offset ?? 0);

  return results;
}
