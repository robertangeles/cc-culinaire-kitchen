/**
 * @module services/pushDeviceService
 *
 * Removing device tokens: a person's own token (unregister, logout), the tokens of a sign-in that has ended,
 * and tokens the push provider says are dead.
 * Registering stays in `notificationsController` (an upsert on the token value).
 */

import { and, eq, gt, inArray, isNull, notExists, or } from "drizzle-orm";
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
 * Removes a person's device tokens whose sign-in has ended: a phone the server signed out must stop receiving that
 * person's pushes. A token registered under a sign-in (`refreshFamilyId`) goes when that sign-in has no unexpired
 * refresh token left; a token with no recorded sign-in goes only when the person has none left at all.
 * Pass the transaction that ended the sign-in when there is one.
 */
export async function removeSignedOutDeviceTokens(userId: number, tx: DbOrTx = db): Promise<void> {
  await tx.delete(deviceToken).where(
    and(
      eq(deviceToken.userId, userId),
      notExists(
        tx
          .select({ id: refreshToken.refreshTokenId })
          .from(refreshToken)
          .where(
            and(
              eq(refreshToken.userId, userId),
              gt(refreshToken.expiresAtDttm, new Date()),
              or(isNull(deviceToken.refreshFamilyId), eq(refreshToken.familyId, deviceToken.refreshFamilyId)),
            ),
          ),
      ),
    ),
  );
}

/** Removes tokens the push provider reported as no longer registered. Their pending receipt rows go with them (ON DELETE CASCADE). */
export async function removeDeadTokens(deviceTokenIds: string[]): Promise<void> {
  if (deviceTokenIds.length === 0) return;
  await db.delete(deviceToken).where(inArray(deviceToken.deviceTokenId, deviceTokenIds));
}
