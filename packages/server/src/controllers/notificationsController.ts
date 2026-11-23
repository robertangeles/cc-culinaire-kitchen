/**
 * @module controllers/notificationsController
 *
 * Request handlers the phone uses for push: register and unregister this device's token, and read and change the
 * person's push settings. Sending is `services/pushDispatcher`. All of it is the caller's own data, so these routes
 * are `authenticate` only, like the notification bell's.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { db } from "../db/index.js";
import { deviceToken } from "../db/schema.js";
import { PushPreferencesUpdateSchema } from "@culinaire/shared/schemas/push";
import { refreshTokenFamily } from "../services/authService.js";
import { removeDeviceToken } from "../services/pushDeviceService.js";
import { presentedRefreshToken } from "../utils/presentedRefreshToken.js";
import { getPushPreferences, updatePushPreferences, PushPreferenceError } from "../services/pushPreferenceService.js";

const logger = pino({ name: "notificationsController" });

const RegisterDeviceSchema = z.object({
  deviceToken: z.string().min(1, "deviceToken is required").max(500),
  platform: z.enum(["android", "ios"]),
});

/**
 * POST /api/notifications/register-device
 *
 * Registers (or refreshes) a push notification token for the authenticated
 * user's device. Upserts on `token_value` — the same token reported twice
 * updates the `last_used_dttm` instead of erroring.
 * The token is tied to the sign-in whose refresh token the request presents (cookie, or `refreshToken` in the
 * body), so it is removed when that sign-in ends. A client that presents none registers with no sign-in.
 */
export async function handleRegisterDevice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated.", code: "UNAUTHENTICATED" });
      return;
    }

    const parsed = RegisterDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages, code: "VALIDATION" });
      return;
    }

    const { deviceToken: tokenValue, platform } = parsed.data;
    const now = new Date();
    const refreshFamilyId = (await refreshTokenFamily(presentedRefreshToken(req), userId)) ?? null;

    await db
      .insert(deviceToken)
      .values({
        userId,
        tokenValue,
        platform,
        refreshFamilyId,
        lastUsedDttm: now,
      })
      .onConflictDoUpdate({
        target: deviceToken.tokenValue,
        set: {
          userId,
          platform,
          refreshFamilyId,
          lastUsedDttm: now,
          updatedDttm: now,
        },
      });

    logger.info({ userId, platform }, "Device token registered");
    res.json({ message: "Device registered." });
  } catch (err) {
    next(err);
  }
}

const UnregisterDeviceSchema = z.object({
  deviceToken: z.string().min(1, "deviceToken is required").max(500),
});

/**
 * POST /api/notifications/unregister-device
 *
 * Removes this device's push token for the authenticated user (the phone calls it when notifications are turned off
 * in the app). Only the caller's own token is removed; one that is not there is not an error, so a repeat is safe.
 */
export async function handleUnregisterDevice(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = UnregisterDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(". "), code: "VALIDATION" });
      return;
    }
    const removed = await removeDeviceToken(userId, parsed.data.deviceToken);
    logger.info({ userId, removed }, "Device token unregistered");
    res.json({ message: "Device unregistered." });
  } catch (err) {
    next(err);
  }
}

/** GET /api/notifications/push-preferences: every notification type with the caller's on/off, and their quiet hours. */
export async function handleGetPushPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated.", code: "UNAUTHENTICATED" });
      return;
    }
    res.json(await getPushPreferences(userId));
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/notifications/push-preferences
 *
 * Body `{ disabledTypes?: string[], quietHours?: { start, end, timeZone } | null }`. `disabledTypes` replaces the list of
 * switched-off types; `quietHours` sets the window (`null` clears it); a key left out changes nothing. Answers with the new settings.
 */
export async function handleUpdatePushPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = PushPreferencesUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(". "), code: "VALIDATION" });
      return;
    }
    res.json(await updatePushPreferences(userId, parsed.data));
  } catch (err) {
    if (err instanceof PushPreferenceError) {
      res.status(err.statusCode).json({ error: err.message, code: "VALIDATION" });
      return;
    }
    next(err);
  }
}
