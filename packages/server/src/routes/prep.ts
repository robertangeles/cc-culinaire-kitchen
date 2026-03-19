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
} from "../controllers/prepController.js";

export const prepRouter = Router();

// All prep routes require authentication
prepRouter.use(authenticate);

// Named routes must be before parameterized routes to avoid collision
prepRouter.get("/sessions/today", handleGetTodaySession);
prepRouter.get("/high-impact", handleGetHighImpact);
prepRouter.get("/history", handleGetHistory);
prepRouter.get("/cross-usage/:sessionId", handleGetCrossUsage);

// Session CRUD
prepRouter.post("/sessions", handleCreateSession);
prepRouter.get("/sessions/:id", handleGetSession);
prepRouter.patch("/sessions/:id/end", handleEndSession);

// Task updates
prepRouter.patch("/tasks/:id", handleUpdateTask);
