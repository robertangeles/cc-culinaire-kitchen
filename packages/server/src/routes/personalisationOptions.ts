/**
 * @module routes/personalisationOptions
 *
 * Public route: GET /api/personalisation-options
 * Admin routes: GET | POST | PATCH | DELETE /api/admin/personalisation-options[/:id]
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleGetActiveOptions,
  handleGetAllOptions,
  handleCreateOption,
  handleUpdateOption,
  handleDeleteOption,
} from "../controllers/personalisationOptionsController.js";

// ---------------------------------------------------------------------------
// Public router — authenticated users only (for KitchenWizard + MyKitchenTab)
// ---------------------------------------------------------------------------
export const personalisationOptionsRouter = Router();

personalisationOptionsRouter.get(
  "/personalisation-options",
  authenticate,
  handleGetActiveOptions
);

// ---------------------------------------------------------------------------
// Admin router — Administrator role required
// ---------------------------------------------------------------------------
export const adminPersonalisationOptionsRouter = Router();

adminPersonalisationOptionsRouter.get(
  "/personalisation-options",
  authenticate,
  requireRole("Administrator"),
  handleGetAllOptions
);

adminPersonalisationOptionsRouter.post(
  "/personalisation-options",
  authenticate,
  requireRole("Administrator"),
  handleCreateOption
);

adminPersonalisationOptionsRouter.patch(
  "/personalisation-options/:id",
  authenticate,
  requireRole("Administrator"),
  handleUpdateOption
);

adminPersonalisationOptionsRouter.delete(
  "/personalisation-options/:id",
  authenticate,
  requireRole("Administrator"),
  handleDeleteOption
);
