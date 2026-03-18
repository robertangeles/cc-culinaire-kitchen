/**
 * @module settingsController
 *
 * Express request handlers for the site-settings API.
 *
 * Delegates to {@link module:settingsService} for database operations
 * and returns JSON responses. The upload handler stores image files
 * and returns their public path for use in settings values.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import {
  getAllSettings,
  upsertSettings,
} from "../services/settingsService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for the PUT body — any string key-value pairs. */
const UpdateSettingsSchema = z.record(z.string(), z.string());

/**
 * **GET /** -- Retrieve all site settings.
 *
 * @returns 200 `{ settings }` with a key-value object.
 */
export async function handleGetSettings(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const settings = await getAllSettings();
    res.json({ settings });
  } catch (err) {
    log.error(err, "Failed to get settings");
    next(err);
  }
}

/**
 * **PUT /** -- Update one or more settings.
 *
 * Request body: `{ [key]: value }` — any number of string key-value pairs.
 *
 * @returns 200 `{ success: true }` on success.
 */
export async function handleUpdateSettings(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = UpdateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await upsertSettings(parsed.data);
    log.info({ keys: Object.keys(parsed.data) }, "Settings updated");
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to update settings");
    next(err);
  }
}

/**
 * **POST /upload** -- Upload an image file (favicon, logo).
 *
 * Expects a multipart form with a single `file` field.
 *
 * @returns 200 `{ path }` with the public URL path to the uploaded file.
 * @returns 400 if no file is provided.
 */
export async function handleUpload(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const { uploadFileBuffer } = await import("../middleware/upload.js");
    const publicPath = await uploadFileBuffer(req.file.buffer, req.file.originalname, "culinaire/site");
    log.info({ path: publicPath }, "File uploaded");
    res.json({ path: publicPath });
  } catch (err) {
    log.error(err, "Failed to upload file");
    next(err);
  }
}
