/**
 * @module services/prepAccess
 *
 * Who may do what to a prep session. Prep belongs to the kitchen, not to the cook who happened to create the
 * session: any member who works at the session's location may read it and tick its tasks; creating, generating
 * and ending are for the creator or a `prep:manage` holder who works there.
 */
import type { prepSession } from "../db/schema.js";
import { hasPermission } from "../middleware/auth.js";
import { canAccessLocation } from "./locationContextService.js";
import type { TokenPayload } from "./authService.js";

type SessionOwnership = Pick<typeof prepSession.$inferSelect, "userId" | "storeLocationId">;

/** The creator always (a session saved with no location has nobody else); otherwise anyone who works at its location. */
export async function canWorkSession(user: TokenPayload, session: SessionOwnership): Promise<boolean> {
  if (session.userId === user.sub) return true;
  return !!session.storeLocationId && (await canAccessLocation(user, session.storeLocationId));
}

/** The creator, or a `prep:manage` holder who works at the session's location. */
export async function canManageSession(user: TokenPayload, session: SessionOwnership): Promise<boolean> {
  if (session.userId === user.sub) return true;
  return hasPermission(user, "prep:manage") && (await canWorkSession(user, session));
}
