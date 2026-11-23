/**
 * @module services/pushDeviceService
 *
 * Removing device tokens: a person's own token (unregister), the tokens of a sign-in that has ended,
 * and tokens the push provider says are dead.
 * Registering stays in `notificationsController` (an upsert on the token value).
 */

import { and, eq, gt, inArray, isNull, notExists, or } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { deviceToken, refreshToken } from "../db/schema.js";

const logger = pino({ name: "pushDeviceService" });

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
 * Call it after the transaction that ended the sign-in has committed, never inside it. It never throws: signing in,
 * refreshing and signing out must not fail because of the push tables, so a failure is logged and the tokens stay
 * until the person's next sign-in, refresh or sign-out.
 */
export async function removeSignedOutDeviceTokens(userId: number): Promise<void> {
  try {
    await db.delete(deviceToken).where(
      and(
        eq(deviceToken.userId, userId),
        notExists(
          db
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
  } catch (err) {
    logger.error({ err, userId }, "Could not remove the device tokens of ended sign-ins");
  }
}

/** Removes tokens the push provider reported as no longer registered. Their pending receipt rows go with them (ON DELETE CASCADE). */
export async function removeDeadTokens(deviceTokenIds: string[]): Promise<void> {
  if (deviceTokenIds.length === 0) return;
  await db.delete(deviceToken).where(inArray(deviceToken.deviceTokenId, deviceTokenIds));
}
