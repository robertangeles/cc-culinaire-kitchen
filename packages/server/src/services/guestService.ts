/**
 * @module services/guestService
 *
 * Service layer for managing anonymous guest chat sessions.
 * Guests can use up to 10 conversations before being prompted to register.
 */

import { eq, sql, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { guestSession, conversation } from "../db/schema.js";
import { pino } from "pino";
import { getAllSettings } from "./settingsService.js";

const log = pino({ name: "guestService" });

const DEFAULT_GUEST_SESSION_LIMIT = 10;
export const MAX_SESSIONS_PER_IP = 50;

/** Read the guest session limit from site settings, falling back to the default. */
async function getGuestSessionLimit(): Promise<number> {
  try {
    const settings = await getAllSettings();
    const val = parseInt(settings.default_guest_sessions ?? "", 10);
    return Number.isFinite(val) && val > 0 ? val : DEFAULT_GUEST_SESSION_LIMIT;
  } catch {
    return DEFAULT_GUEST_SESSION_LIMIT;
  }
}

/** Count how many guest sessions exist for a given IP address. */
export async function countSessionsByIp(ip: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(guestSession)
    .where(eq(guestSession.ipAddress, ip));
  return Number(rows[0]?.count ?? 0);
}

/** Create a new guest session with the given token and client IP. */
export async function createGuestSession(token: string, ipAddress?: string) {
  const limit = await getGuestSessionLimit();
  await db.insert(guestSession).values({ sessionToken: token, ipAddress: ipAddress ?? null });
  return { sessionToken: token, sessionsUsed: 0, sessionsLimit: limit };
}

/** Validate and return a guest session by token. Returns null if not found. */
export async function getGuestSession(token: string) {
  const rows = await db
    .select()
    .from(guestSession)
    .where(eq(guestSession.sessionToken, token));

  if (rows.length === 0) return null;

  // Update last active timestamp
  await db
    .update(guestSession)
    .set({ lastActiveDttm: new Date() })
    .where(eq(guestSession.sessionToken, token));

  return rows[0];
}

/** Check if a guest session has remaining conversations. */
export async function hasGuestQuota(token: string): Promise<boolean> {
  const session = await getGuestSession(token);
  if (!session) return false;
  const limit = await getGuestSessionLimit();
  return session.sessionsUsed < limit;
}

/** Increment the sessions_used counter for a guest. */
export async function incrementGuestSessions(token: string) {
  const session = await getGuestSession(token);
  if (!session) return;

  await db
    .update(guestSession)
    .set({
      sessionsUsed: session.sessionsUsed + 1,
      lastActiveDttm: new Date(),
    })
    .where(eq(guestSession.sessionToken, token));
}

/** Get guest session limit and usage info. */
export async function getGuestUsage(token: string) {
  const session = await getGuestSession(token);
  if (!session) return null;

  const limit = await getGuestSessionLimit();
  return {
    sessionsUsed: session.sessionsUsed,
    sessionsLimit: limit,
    sessionsRemaining: limit - session.sessionsUsed,
  };
}

/**
 * Link all guest conversations to a newly registered user.
 * Called during guest-to-user conversion after registration.
 */
export async function linkGuestConversations(token: string, userId: number) {
  // Update all conversations with this guest token to belong to the new user
  await db
    .update(conversation)
    .set({ userId, guestSessionToken: null })
    .where(eq(conversation.guestSessionToken, token));

  // Delete the guest session record
  await db.delete(guestSession).where(eq(guestSession.sessionToken, token));
}

/**
 * Delete guest sessions that have been idle for longer than the given
 * number of hours. Also deletes any conversations linked to those sessions.
 *
 * @param maxIdleHours - Sessions inactive for longer than this are removed.
 * @returns The number of sessions deleted.
 */
export async function cleanupStaleSessions(maxIdleHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - maxIdleHours * 60 * 60 * 1000);

  // Find stale session tokens
  const stale = await db
    .select({ sessionToken: guestSession.sessionToken })
    .from(guestSession)
    .where(lt(guestSession.lastActiveDttm, cutoff));

  if (stale.length === 0) return 0;

  const tokens = stale.map((s) => s.sessionToken);

  // Delete linked conversations first (FK constraint)
  for (const token of tokens) {
    await db.delete(conversation).where(eq(conversation.guestSessionToken, token));
  }

  // Delete the stale sessions
  for (const token of tokens) {
    await db.delete(guestSession).where(eq(guestSession.sessionToken, token));
  }

  log.info({ count: stale.length, maxIdleHours }, "Cleaned up stale guest sessions");
  return stale.length;
}
