/**
 * @module conversationService
 *
 * Service layer for managing chat conversations and their messages.
 *
 * Provides CRUD operations for conversations and message persistence.
 * Conversations are identified by client-generated UUIDs. Messages are
 * stored with a sequence number for ordering and linked to their parent
 * conversation via `conversation_id` FK.
 */

import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversation, message } from "../db/schema.js";

/**
 * Create a new conversation scoped to a user.
 *
 * @param id     - Client-generated UUID for the conversation.
 * @param title  - Display title (typically derived from the first user message).
 * @param userId - Owner user ID.
 */
export async function createConversation(
  id: string,
  title: string,
  userId: number
): Promise<void> {
  await db.insert(conversation).values({
    conversationId: id,
    conversationTitle: title,
    userId,
  });
}

/**
 * List conversations for a specific user, ordered by most recently updated.
 *
 * @param userId - Owner user ID.
 * @returns Array of conversation metadata (no messages).
 */
export async function listConversations(userId: number) {
  return db
    .select()
    .from(conversation)
    .where(eq(conversation.userId, userId))
    .orderBy(desc(conversation.updatedDttm));
}

/**
 * Retrieve a single conversation with all its messages, scoped to a user.
 *
 * @param id     - Conversation UUID.
 * @param userId - Owner user ID (ensures users can only access their own).
 * @returns The conversation record and its messages sorted by sequence,
 *          or `null` if not found or belongs to another user.
 */
export async function getConversationWithMessages(id: string, userId: number) {
  const convRows = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.conversationId, id), eq(conversation.userId, userId)));

  if (convRows.length === 0) return null;

  const messages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(message.messageSequence);

  return { ...convRows[0], messages };
}

/**
 * Update the conversation title.
 *
 * @param id    - Conversation UUID.
 * @param title - New title.
 */
export async function updateConversationTitle(
  id: string,
  title: string,
  userId: number
): Promise<void> {
  await db
    .update(conversation)
    .set({ conversationTitle: title, updatedDttm: new Date() })
    .where(and(eq(conversation.conversationId, id), eq(conversation.userId, userId)));
}

/**
 * Append messages to a conversation and refresh `updated_dttm`.
 *
 * @param conversationId - Parent conversation UUID.
 * @param msgs           - Array of messages to insert.
 */
export async function saveMessages(
  conversationId: string,
  msgs: Array<{
    messageId: string;
    messageRole: string;
    messageBody: string;
    messageSequence: number;
  }>
): Promise<void> {
  if (msgs.length === 0) return;

  await db.insert(message).values(
    msgs.map((m) => ({
      messageId: m.messageId,
      conversationId,
      messageRole: m.messageRole,
      messageBody: m.messageBody,
      messageSequence: m.messageSequence,
    }))
  );

  // Touch updated_dttm on the parent conversation
  await db
    .update(conversation)
    .set({ updatedDttm: new Date() })
    .where(eq(conversation.conversationId, conversationId));
}

/**
 * Delete a conversation and all its messages (cascade via application logic).
 *
 * @param id - Conversation UUID.
 */
export async function deleteConversation(id: string, userId: number): Promise<void> {
  // Verify ownership before deleting
  const convRows = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.conversationId, id), eq(conversation.userId, userId)));

  if (convRows.length === 0) return;

  // Delete messages first (no DB-level cascade defined)
  await db.delete(message).where(eq(message.conversationId, id));
  await db.delete(conversation).where(eq(conversation.conversationId, id));
}

// ---------------------------------------------------------------------------
// Guest conversation operations
// ---------------------------------------------------------------------------

/**
 * Create a new conversation for a guest user (no userId, tracked by guest token).
 *
 * @param id         - Client-generated UUID for the conversation.
 * @param title      - Display title.
 * @param guestToken - Guest session token for ownership tracking.
 */
export async function createGuestConversation(
  id: string,
  title: string,
  guestToken: string,
): Promise<void> {
  await db.insert(conversation).values({
    conversationId: id,
    conversationTitle: title,
    userId: null,
    guestSessionToken: guestToken,
  });
}

/**
 * List conversations for a guest user, ordered by most recently updated.
 *
 * @param guestToken - Guest session token.
 */
export async function listGuestConversations(guestToken: string) {
  return db
    .select()
    .from(conversation)
    .where(eq(conversation.guestSessionToken, guestToken))
    .orderBy(desc(conversation.updatedDttm));
}

/**
 * Retrieve a single conversation with all its messages, scoped to a guest token.
 *
 * @param id         - Conversation UUID.
 * @param guestToken - Guest session token (ensures guests can only access their own).
 */
export async function getGuestConversationWithMessages(id: string, guestToken: string) {
  const convRows = await db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.conversationId, id),
        eq(conversation.guestSessionToken, guestToken),
      ),
    );

  if (convRows.length === 0) return null;

  const messages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(message.messageSequence);

  return { ...convRows[0], messages };
}

/**
 * Update the conversation title for a guest conversation.
 *
 * @param id         - Conversation UUID.
 * @param title      - New title.
 * @param guestToken - Guest session token.
 */
export async function updateGuestConversationTitle(
  id: string,
  title: string,
  guestToken: string,
): Promise<void> {
  await db
    .update(conversation)
    .set({ conversationTitle: title, updatedDttm: new Date() })
    .where(
      and(
        eq(conversation.conversationId, id),
        eq(conversation.guestSessionToken, guestToken),
      ),
    );
}

/**
 * Delete a guest conversation and all its messages.
 *
 * @param id         - Conversation UUID.
 * @param guestToken - Guest session token.
 */
export async function deleteGuestConversation(id: string, guestToken: string): Promise<void> {
  // Verify ownership before deleting
  const convRows = await db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.conversationId, id),
        eq(conversation.guestSessionToken, guestToken),
      ),
    );

  if (convRows.length === 0) return;

  // Delete messages first (no DB-level cascade defined)
  await db.delete(message).where(eq(message.conversationId, id));
  await db.delete(conversation).where(eq(conversation.conversationId, id));
}
