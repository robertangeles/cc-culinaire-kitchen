/**
 * @module routes/prep
 *
 * API routes for the Kitchen Operations Copilot Lite module.
 * All routes require authentication.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
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
  handleSaveSelections,
  handleGenerateFromSelections,
  handleGetSelections,
  handleGetPreviousSelections,
} from "../controllers/prepController.js";

export const prepRouter = Router();

// All prep routes require authentication
prepRouter.use(authenticate);

// Named routes must be before parameterized routes to avoid collision
prepRouter.get("/menu", handleGetMenuForSelection);
prepRouter.get("/previous-selections", handleGetPreviousSelections);
prepRouter.get("/sessions/today", handleGetTodaySession);
prepRouter.get("/high-impact", handleGetHighImpact);
prepRouter.get("/history", handleGetHistory);
prepRouter.get("/cross-usage/:sessionId", handleGetCrossUsage);

// Session CRUD
prepRouter.post("/sessions", handleCreateSession);
prepRouter.get("/sessions/:id", handleGetSession);
prepRouter.patch("/sessions/:id/end", handleEndSession);

// Menu-driven selection and generation routes
prepRouter.post("/sessions/:id/selections", handleSaveSelections);
prepRouter.post("/sessions/:id/generate", handleGenerateFromSelections);
prepRouter.get("/sessions/:id/selections", handleGetSelections);

// Task updates
prepRouter.patch("/tasks/:id", handleUpdateTask);
