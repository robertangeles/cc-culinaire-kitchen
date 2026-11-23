/**
 * @module services/pushDeviceService
 *
 * Removing device tokens: a person's own token (unregister, logout), every token of a person whose sign-ins have
 * all ended, and tokens the push provider says are dead.
 * Registering stays in `notificationsController` (an upsert on the token value).
 */

import { and, eq, gt, inArray, notExists } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceToken, refreshToken } from "../db/schema.js";
import type { DbOrTx } from "./auditService.js";

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

/**
 * Removes every device token of a person who has no live sign-in left (no unexpired refresh token): a phone that
 * was signed out by the server must stop receiving that person's pushes. Does nothing while any sign-in is alive,
 * because a device token is not tied to the sign-in that registered it. Run it in the transaction that ended the sign-in.
 */
export async function removeDeviceTokensIfSignedOut(userId: number, tx: DbOrTx): Promise<void> {
  await tx.delete(deviceToken).where(
    and(
      eq(deviceToken.userId, userId),
      notExists(
        tx
          .select({ id: refreshToken.refreshTokenId })
          .from(refreshToken)
          .where(and(eq(refreshToken.userId, userId), gt(refreshToken.expiresAtDttm, new Date()))),
      ),
    ),
  );
}

/** Removes tokens the push provider reported as no longer registered. Their pending receipt rows go with them (ON DELETE CASCADE). */
export async function removeDeadTokens(deviceTokenIds: string[]): Promise<void> {
  if (deviceTokenIds.length === 0) return;
  await db.delete(deviceToken).where(inArray(deviceToken.deviceTokenId, deviceTokenIds));
}
