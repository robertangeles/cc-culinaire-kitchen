/**
 * @module services/pushDispatcher
 *
 * Sends a push for an in-app notification that has been saved. The in-app row is the record; the push only tells
 * the person to open the app, so a push that is skipped or fails never loses the notification.
 *
 * `notifyAndPush` is what a producer calls once the change it reports has committed. It never throws into the
 * request that called it: a failed notification must not fail a roster publish or a document verification.
 * `{ push: false }` saves the in-app notice only: a Draft shift is still being built, so it never reaches a lock screen.
 *
 * Skipped, in this order: the provider switch is off; the recipient is not an active member of the notification's
 * organisation; the person switched that type off; it is inside their quiet hours (dropped, not held back: the inbox has it).
 * The text is `pushCopy` (fixed per type) and the route is `pushLink`; the payload never reaches the wire.
 *
 * Delivery receipts: Expo answers a send with a ticket, and the real outcome (notably "this token is dead") only some
 * minutes later. `processPushReceipts` reads those and removes dead tokens. A token Expo already calls dead in the
 * ticket is removed at once.
 */

import { and, asc, eq, inArray, lte, lt } from "drizzle-orm";
import pino from "pino";
import { pushLink } from "@culinaire/shared/schemas/push";
import { db } from "../db/index.js";
import { deviceToken, pushOptOuts, pushQuietHours, pushReceipts, user, userOrganisation } from "../db/schema.js";
import { getCredentialValueWithFallback } from "./credentialService.js";
import { createExpoPushProvider, type PushMessage, type PushProvider } from "./expoPushProvider.js";
import { createInApp, type CreateNotificationParams } from "./notificationService.js";
import { removeDeadTokens } from "./pushDeviceService.js";
import { pushCopy } from "./pushCopy.js";
import { isQuietNow } from "./pushQuietHours.js";

const logger = pino({ name: "pushDispatcher" });

/** Expo has the receipt for a ticket some 15 minutes after the send. */
const RECEIPT_MIN_AGE_MS = 15 * 60 * 1000;
/** Expo keeps receipts for a day; a ticket older than that has no answer coming. */
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RECEIPT_BATCH = 1000;

/** A token an Expo push call can address. Anything else (a raw APNs or FCM token from an older build) is skipped. */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[.+\]$/;

export interface PushableNotification {
  notificationId: string;
  organisationId: number;
  recipientUserId: number;
  type: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}

let testProvider: PushProvider | null = null;

/** Test hook: use this provider instead of Expo (and ignore the switch). `null` goes back to the real settings. */
export function setPushProviderForTests(provider: PushProvider | null): void {
  testProvider = provider;
}

/** Settings (Integrations panel, read at call time): EXPO_PUSH_ENABLED must read "true"; EXPO_ACCESS_TOKEN is optional. */
async function resolveProvider(): Promise<PushProvider | null> {
  if (testProvider) return testProvider;
  if ((await getCredentialValueWithFallback("EXPO_PUSH_ENABLED")).trim().toLowerCase() !== "true") return null;
  const accessToken = (await getCredentialValueWithFallback("EXPO_ACCESS_TOKEN")) || undefined;
  return createExpoPushProvider({ accessToken });
}

/** Pushes `notification` to the recipient's devices if they are meant to get it. Never throws. */
export async function dispatchPush(notification: PushableNotification, now: Date = new Date()): Promise<void> {
  try {
    const provider = await resolveProvider();
    if (!provider) return;

    const [recipient] = await db
      .select({ userId: user.userId })
      .from(user)
      .innerJoin(userOrganisation, eq(userOrganisation.userId, user.userId))
      .where(
        and(
          eq(user.userId, notification.recipientUserId),
          eq(user.userStatus, "active"),
          eq(userOrganisation.organisationId, notification.organisationId),
        ),
      )
      .limit(1);
    if (!recipient) return;

    const [optedOut] = await db
      .select({ id: pushOptOuts.id })
      .from(pushOptOuts)
      .where(and(eq(pushOptOuts.userId, notification.recipientUserId), eq(pushOptOuts.notificationType, notification.type)))
      .limit(1);
    if (optedOut) return;

    const [quiet] = await db
      .select({ startMinute: pushQuietHours.startMinute, endMinute: pushQuietHours.endMinute, timeZone: pushQuietHours.timeZone })
      .from(pushQuietHours)
      .where(eq(pushQuietHours.userId, notification.recipientUserId));
    if (quiet && isQuietNow(now, quiet)) return;

    const tokens = (
      await db
        .select({ id: deviceToken.deviceTokenId, value: deviceToken.tokenValue })
        .from(deviceToken)
        .where(eq(deviceToken.userId, notification.recipientUserId))
    ).filter((t) => EXPO_TOKEN.test(t.value));
    if (tokens.length === 0) return;

    const { title, body } = pushCopy(notification.type);
    const data = {
      notificationId: notification.notificationId,
      type: notification.type,
      link: pushLink(notification.type, notification.relatedEntityType, notification.relatedEntityId),
    };
    const messages: PushMessage[] = tokens.map((t) => ({ to: t.value, title, body, data, sound: "default" }));

    const tickets = await provider.send(messages);

    const dead: string[] = [];
    const pending: Array<{ deviceTokenId: string; ticketId: string }> = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") pending.push({ deviceTokenId: tokens[i].id, ticketId: ticket.id });
      else if (ticket.error === "DeviceNotRegistered") dead.push(tokens[i].id);
      else logger.warn({ notificationId: notification.notificationId, error: ticket.error, message: ticket.message }, "Push provider refused a message");
    });
    await removeDeadTokens(dead);
    if (pending.length > 0) await db.insert(pushReceipts).values(pending);
  } catch (err) {
    logger.error({ err, notificationId: notification.notificationId }, "Push dispatch failed");
  }
}

const inFlight = new Set<Promise<void>>();

/**
 * Saves the in-app notification and, once it is saved, pushes it without making the caller wait for the provider.
 * Call after the change it reports has committed. Never throws. `push: false` saves the in-app notification only.
 */
export async function notifyAndPush(params: Omit<CreateNotificationParams, "channel">, opts: { push?: boolean } = {}): Promise<void> {
  try {
    const row = await createInApp(params);
    if (opts.push === false) return;
    const push = dispatchPush(row);
    inFlight.add(push);
    void push.finally(() => inFlight.delete(push));
  } catch (err) {
    logger.error({ err, type: params.type, userId: params.recipientUserId }, "Could not save an in-app notification");
  }
}

/** Waits for the pushes started so far: for tests, and for a graceful shutdown. */
export async function drainPushDispatch(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

export interface ReceiptRun {
  checked: number;
  deadTokens: number;
  gaveUp: number;
}

/**
 * Reads the delivery receipts of tickets old enough to have one. A `DeviceNotRegistered` receipt removes that token;
 * any other error is logged and kept (the token may be fine). A ticket with no receipt yet stays for the next run;
 * one older than a day is dropped without a verdict. A provider that cannot be reached leaves everything for the next run.
 */
export async function processPushReceipts(now: Date = new Date()): Promise<ReceiptRun> {
  const run: ReceiptRun = { checked: 0, deadTokens: 0, gaveUp: 0 };
  try {
    const stale = await db
      .delete(pushReceipts)
      .where(lt(pushReceipts.createdAt, new Date(now.getTime() - RECEIPT_MAX_AGE_MS)))
      .returning({ id: pushReceipts.id });
    run.gaveUp = stale.length;

    const provider = await resolveProvider();
    if (!provider) return run;

    const due = await db
      .select({ id: pushReceipts.id, deviceTokenId: pushReceipts.deviceTokenId, ticketId: pushReceipts.ticketId })
      .from(pushReceipts)
      .where(lte(pushReceipts.createdAt, new Date(now.getTime() - RECEIPT_MIN_AGE_MS)))
      .orderBy(asc(pushReceipts.createdAt))
      .limit(RECEIPT_BATCH);
    if (due.length === 0) return run;

    const receipts = await provider.receipts(due.map((r) => r.ticketId));
    const answered: string[] = [];
    const dead = new Set<string>();
    for (const row of due) {
      const receipt = receipts.get(row.ticketId);
      if (!receipt) continue;
      answered.push(row.id);
      if (receipt.status === "error") {
        if (receipt.error === "DeviceNotRegistered") dead.add(row.deviceTokenId);
        else logger.warn({ ticketId: row.ticketId, error: receipt.error, message: receipt.message }, "Push receipt reported an error");
      }
    }
    run.checked = answered.length;
    run.deadTokens = dead.size;
    // Dead tokens first: deleting a token cascades to its receipt rows.
    await removeDeadTokens([...dead]);
    if (answered.length > 0) await db.delete(pushReceipts).where(inArray(pushReceipts.id, answered));
  } catch (err) {
    logger.error({ err }, "Reading push receipts failed");
  }
  return run;
}
