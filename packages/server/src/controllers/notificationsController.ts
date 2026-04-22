/**
 * @module controllers/notificationsController
 *
 * Request handlers for device-token registration from the mobile client.
 * Actual push dispatch (FCM for Android, APNs for iOS) is wired when the
 * native app is ready to send/receive — for v1 this endpoint only persists
 * the token so the backend has what it needs to fan out later.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { db } from "../db/index.js";
import { deviceToken } from "../db/schema.js";

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
 */
export async function handleRegisterDevice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    const parsed = RegisterDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const { deviceToken: tokenValue, platform } = parsed.data;
    const now = new Date();

    await db
      .insert(deviceToken)
      .values({
        userId,
        tokenValue,
        platform,
        lastUsedDttm: now,
      })
      .onConflictDoUpdate({
        target: deviceToken.tokenValue,
        set: {
          userId,
          platform,
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
