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

import { eq, desc, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { conversation, message } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

/**
 * Insert a conversation unless the id is taken. A replay by the same owner is not an error
 * (the phone retries a create it never saw the answer to); an id held by someone else is a 409.
 *
 * @returns true when a row was created, false when the caller already owned it.
 */
async function insertConversation(
  id: string,
  title: string,
  owner: { userId: number } | { guestToken: string },
): Promise<boolean> {
  const mine = "userId" in owner
    ? { userId: owner.userId, guestSessionToken: null }
    : { userId: null, guestSessionToken: owner.guestToken };
  const inserted = await db
    .insert(conversation)
    .values({ conversationId: id, conversationTitle: title, ...mine })
    .onConflictDoNothing()
    .returning({ id: conversation.conversationId });
  if (inserted.length > 0) return true;

  const [existing] = await db
    .select({ userId: conversation.userId, guestToken: conversation.guestSessionToken })
    .from(conversation)
    .where(eq(conversation.conversationId, id));
  const owns = existing && ("userId" in owner ? existing.userId === owner.userId : existing.guestToken === owner.guestToken);
  if (!owns) throw new AppError(409, "CONFLICT", "That conversation id is already in use.");
  return false;
}

/**
 * Create a new conversation scoped to a user.
 *
 * @param id     - Client-generated UUID for the conversation.
 * @param title  - Display title (typically derived from the first user message).
 * @param userId - Owner user ID.
 * @returns true when created, false when the same user had already created it.
 */
export function createConversation(id: string, title: string, userId: number): Promise<boolean> {
  return insertConversation(id, title, { userId });
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
 * Append messages to a conversation and refresh `updated_dttm`. A message id that is already stored is
 * skipped, so a replayed save adds only what is new.
 *
 * @param conversationId - Parent conversation UUID.
 * @param msgs           - Array of messages to insert.
 * @returns `false` on a cross-owner write; otherwise the messages this call actually inserted (a replay
 *          inserts none).
 */
export async function saveMessages(
  conversationId: string,
  owner: { userId: number } | { guestToken: string },
  msgs: Array<{
    messageId: string;
    messageRole: string;
    messageBody: string;
    messageSequence: number;
  }>
): Promise<false | Array<{ messageId: string }>> {
  // Ownership guard: if the conversation already exists it MUST belong to the
  // caller — a userId match for authenticated users, or a guestSessionToken
  // match for guests (guest rows have userId NULL, so NULL alone is not enough
  // to distinguish one guest from another). A conversation that does not exist
  // yet is allowed through so the client's create-then-save flow still works.
  // Returns false on a cross-owner write attempt.
  const [conv] = await db
    .select({ userId: conversation.userId, guestToken: conversation.guestSessionToken })
    .from(conversation)
    .where(eq(conversation.conversationId, conversationId));
  if (conv) {
    const owns =
      "userId" in owner
        ? conv.userId === owner.userId
        : conv.guestToken === owner.guestToken;
    if (!owns) return false;
  }

  if (msgs.length === 0) return [];

  const inserted = await db.insert(message).values(
    msgs.map((m) => ({
      messageId: m.messageId,
      conversationId,
      messageRole: m.messageRole,
      messageBody: m.messageBody,
      messageSequence: m.messageSequence,
    }))
  ).onConflictDoNothing({ target: message.messageId }).returning({ messageId: message.messageId });

  // Touch updated_dttm on the parent conversation
  await db
    .update(conversation)
    .set({ updatedDttm: new Date() })
    .where(eq(conversation.conversationId, conversationId));

  return inserted;
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
 * @returns true when created, false when the same guest had already created it.
 */
export function createGuestConversation(id: string, title: string, guestToken: string): Promise<boolean> {
  return insertConversation(id, title, { guestToken });
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
