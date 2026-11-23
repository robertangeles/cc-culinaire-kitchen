/**
 * @module services/pushDeviceService
 *
 * Removing device tokens: a person's own token (unregister, logout) and tokens the push provider says are dead.
 * Registering stays in `notificationsController` (an upsert on the token value).
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceToken } from "../db/schema.js";

/**
 * Removes one device token, but only if it belongs to `userId`: a token is a bearer address for a person's
 * notifications, so one person must not be able to switch off another's by guessing its value.
 * Idempotent: a token that is not there (already removed, or never registered) is not an error.
 * Returns whether a row was removed.
 */
export async function removeDeviceToken(userId: number, tokenValue: string): Promise<boolean> {
  const removed = await db
    .delete(deviceToken)
    .where(and(eq(deviceToken.userId, userId), eq(deviceToken.tokenValue, tokenValue)))
    .returning({ id: deviceToken.deviceTokenId });
  return removed.length > 0;
}

/** Removes tokens the push provider reported as no longer registered. Their pending receipt rows go with them (ON DELETE CASCADE). */
export async function removeDeadTokens(deviceTokenIds: string[]): Promise<void> {
  if (deviceTokenIds.length === 0) return;
  await db.delete(deviceToken).where(inArray(deviceToken.deviceTokenId, deviceTokenIds));
}
