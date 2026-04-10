/**
 * @module controllers/notificationController
 *
 * Notification bell API — unread count, list, mark as read/dismissed.
 */

import type { Request, Response, NextFunction } from "express";
import * as notificationService from "../services/notificationService.js";

export async function handleGetUnread(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const notifications = await notificationService.getUnreadForUser(userId, limit);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

export async function handleGetUnreadCount(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const count = await notificationService.getUnreadCount(userId);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

export async function handleMarkAsRead(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const notificationId = req.params.id as string;

    const result = await notificationService.markAsRead(notificationId, userId);
    if (!result) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleDismiss(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.sub;
    const notificationId = req.params.id as string;

    const result = await notificationService.dismiss(notificationId, userId);
    if (!result) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}
