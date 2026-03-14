/**
 * @module settings (router)
 *
 * Express router for the site-settings API, mounted at `/api/settings`.
 *
 * Endpoints:
 *  - `GET    /`        -- Retrieve all settings.
 *  - `PUT    /`        -- Update one or more settings.
 *  - `POST   /upload`  -- Upload an image file (favicon, logo).
 */

import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleGetSettings,
  handleUpdateSettings,
  handleUpload,
} from "../controllers/settingsController.js";

export const settingsRouter = Router();

// GET is public (needed for branding on login page)
settingsRouter.get("/", handleGetSettings);

// Mutations require Admin role
settingsRouter.put("/", authenticate, requireRole("Administrator"), handleUpdateSettings);
settingsRouter.post("/upload", authenticate, requireRole("Administrator"), upload.single("file"), handleUpload);
