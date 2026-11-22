/**
 * @module routes/prep
 *
 * API routes for the Kitchen Operations Copilot Lite module.
 * All routes require authentication.
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  handleCreateSession,
  handleGetTodaySession,
  handleGetSession,
  handleUpdateTask,
  handleGetCrossUsage,
  handleGetHighImpact,
  handleGetHistory,
  handleEndSession,
  handleGetMenuForSelection,
  handleForecastSuggest,
  handleSaveSelections,
  handleGenerateFromSelections,
  handleGetSelections,
  handleGetPreviousSelections,
} from "../controllers/prepController.js";

export const prepRouter = Router();

// All prep routes require authentication + prep:read (look, tick) or prep:manage (also create, generate, end).
prepRouter.use(authenticate);
prepRouter.use(requirePermission("prep:read", "prep:manage"));

// Named routes must be before parameterized routes to avoid collision
prepRouter.get("/menu", handleGetMenuForSelection);
prepRouter.get("/forecast-suggest", handleForecastSuggest);
prepRouter.get("/previous-selections", handleGetPreviousSelections);
prepRouter.get("/sessions/today", handleGetTodaySession);
prepRouter.get("/high-impact", handleGetHighImpact);
prepRouter.get("/history", handleGetHistory);
prepRouter.get("/cross-usage/:sessionId", handleGetCrossUsage);

// Session CRUD
prepRouter.post("/sessions", requirePermission("prep:manage"), handleCreateSession);
prepRouter.get("/sessions/:id", handleGetSession);
prepRouter.patch("/sessions/:id/end", requirePermission("prep:manage"), handleEndSession);

// Menu-driven selection and generation routes
prepRouter.post("/sessions/:id/selections", requirePermission("prep:manage"), handleSaveSelections);
prepRouter.post("/sessions/:id/generate", requirePermission("prep:manage"), handleGenerateFromSelections);
prepRouter.get("/sessions/:id/selections", handleGetSelections);

// Task updates: any member at the session's location may tick (the service checks the location)
prepRouter.patch("/tasks/:id", handleUpdateTask);
