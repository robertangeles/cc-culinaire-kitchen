/**
 * @module services/pushPreferenceService
 *
 * A person's push settings: which notification types they switched off, and their quiet hours. Both are theirs alone
 * (the caller's own user id; there is no way to read or change another person's) and neither touches the in-app inbox.
 */

import { and, eq, notInArray } from "drizzle-orm";
import { NOTIFICATION_TYPES, type QuietHours, type PushPreferencesUpdate } from "@culinaire/shared/schemas/push";
import { db } from "../db/index.js";
import { pushOptOuts, pushQuietHours } from "../db/schema.js";
import { PUSH_TYPE_LABELS } from "./pushCopy.js";
import { isKnownTimeZone, minutesOf, timeOfDayOf } from "./pushQuietHours.js";

/** `GET` and `PUT /api/notifications/push-preferences`. */
export interface PushPreferences {
  types: { type: string; label: string; enabled: boolean }[];
  quietHours: QuietHours | null;
}

export class PushPreferenceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "PushPreferenceError";
  }
}

/** Every type with the person's on/off, and their quiet hours (null when they have none). */
export async function getPushPreferences(userId: number): Promise<PushPreferences> {
  const [off, [window]] = await Promise.all([
    db.select({ type: pushOptOuts.notificationType }).from(pushOptOuts).where(eq(pushOptOuts.userId, userId)),
    db
      .select({ startMinute: pushQuietHours.startMinute, endMinute: pushQuietHours.endMinute, timeZone: pushQuietHours.timeZone })
      .from(pushQuietHours)
      .where(eq(pushQuietHours.userId, userId)),
  ]);
  const disabled = new Set(off.map((r) => r.type));
  return {
    types: NOTIFICATION_TYPES.map((type) => ({ type, label: PUSH_TYPE_LABELS[type], enabled: !disabled.has(type) })),
    quietHours: window ? { start: timeOfDayOf(window.startMinute), end: timeOfDayOf(window.endMinute), timeZone: window.timeZone } : null,
  };
}

/**
 * Applies a partial update: `disabledTypes` replaces the whole list, `quietHours` sets or (null) clears the window; a key left out
 * changes nothing. The body has already been checked against `PushPreferencesUpdateSchema`; the time zone is checked here, since only the server knows its zone data.
 */
export async function updatePushPreferences(userId: number, update: PushPreferencesUpdate): Promise<PushPreferences> {
  if (update.quietHours && !isKnownTimeZone(update.quietHours.timeZone)) {
    throw new PushPreferenceError(`"${update.quietHours.timeZone}" is not a time zone this server knows.`);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    if (update.disabledTypes) {
      const wanted = [...new Set(update.disabledTypes)];
      if (wanted.length === 0) await tx.delete(pushOptOuts).where(eq(pushOptOuts.userId, userId));
      else {
        await tx.delete(pushOptOuts).where(and(eq(pushOptOuts.userId, userId), notInArray(pushOptOuts.notificationType, wanted)));
        await tx
          .insert(pushOptOuts)
          .values(wanted.map((notificationType) => ({ userId, notificationType })))
          .onConflictDoNothing();
      }
    }
    if (update.quietHours === null) {
      await tx.delete(pushQuietHours).where(eq(pushQuietHours.userId, userId));
    } else if (update.quietHours) {
      const values = { startMinute: minutesOf(update.quietHours.start), endMinute: minutesOf(update.quietHours.end), timeZone: update.quietHours.timeZone };
      await tx
        .insert(pushQuietHours)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: pushQuietHours.userId, set: { ...values, updatedAt: now } });
    }
  });
  return getPushPreferences(userId);
}
