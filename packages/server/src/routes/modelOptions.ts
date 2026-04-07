/**
 * @module modelOptions (router)
 *
 * Express router for the model-options API, mounted at `/api/model-options`.
 *
 * Endpoints:
 *  - `GET    /`          — List enabled models (authenticated users).
 *  - `GET    /all`       — List all models including disabled (admin).
 *  - `GET    /available` — Fetch full OpenRouter catalog (admin).
 *  - `POST   /`          — Enable a model from the catalog (admin).
 *  - `DELETE /:id`       — Soft-disable a model (admin).
 *  - `PATCH  /:id`       — Update sort order (admin).
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleListEnabled,
  handleListAll,
  handleFetchAvailable,
  handleEnable,
  handleDisable,
  handleUpdateSort,
} from "../controllers/modelOptionsController.js";

export const modelOptionsRouter = Router();

// Enabled models list — available to all authenticated users (for prompt dropdown)
modelOptionsRouter.get("/", authenticate, handleListEnabled);

// Admin-only routes
modelOptionsRouter.get("/all", authenticate, requireRole("Administrator"), handleListAll);
modelOptionsRouter.get("/available", authenticate, requireRole("Administrator"), handleFetchAvailable);
modelOptionsRouter.post("/", authenticate, requireRole("Administrator"), handleEnable);
modelOptionsRouter.delete("/:id", authenticate, requireRole("Administrator"), handleDisable);
modelOptionsRouter.patch("/:id", authenticate, requireRole("Administrator"), handleUpdateSort);
