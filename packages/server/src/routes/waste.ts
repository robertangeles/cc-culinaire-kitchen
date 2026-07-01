/**
 * @module routes/waste
 *
 * API routes for the Waste Intelligence Lite module.
 * All routes require authentication.
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  handleLogWaste,
  handleGetWasteLogs,
  handleDeleteWasteLog,
  handleEditWasteLog,
  handleGetWasteSummary,
  handleGetIngredientSuggestions,
  handleGenerateReuseSuggestions,
  handleGetOrgContext,
} from "../controllers/wasteController.js";

export const wasteRouter = Router();

// All waste routes require authentication + the Waste module permission.
wasteRouter.use(authenticate);
wasteRouter.use(requirePermission("waste:read"));

// Summary must be before /:id to avoid route collision
wasteRouter.get("/summary", handleGetWasteSummary);
wasteRouter.get("/suggestions", handleGetIngredientSuggestions);
wasteRouter.get("/org-context", handleGetOrgContext);
wasteRouter.post("/reuse", handleGenerateReuseSuggestions);

// CRUD
wasteRouter.post("/", handleLogWaste);
wasteRouter.get("/", handleGetWasteLogs);
wasteRouter.patch("/:id", handleEditWasteLog);
wasteRouter.delete("/:id", handleDeleteWasteLog);
