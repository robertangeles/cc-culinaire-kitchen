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
  handleListIngredientsForWaste,
  handleGenerateReuseSuggestions,
  handleGetOrgContext,
} from "../controllers/wasteController.js";

export const wasteRouter = Router();

// All waste routes require authentication.
wasteRouter.use(authenticate);

// The team/personal toggle of both the Waste and the Prep pages asks this, so a prep-only user must pass.
// It answers only about the caller's own organisation. Registered before the module gate below.
wasteRouter.get(
  "/org-context",
  requirePermission("waste:read", "waste:log", "prep:read", "prep:manage"),
  handleGetOrgContext,
);

// The phone's waste picker lists the organisation's ingredients (id, name, unit only). A cook who may log waste but not count
// stock cannot read GET /api/inventory/ingredients, so this is the one door; inventory:count holders may read the same list.
wasteRouter.get("/ingredients", requirePermission("waste:log", "inventory:count"), handleListIngredientsForWaste);

// The module needs waste:read (reports and cost) or waste:log (log your own entries); each route below says which.
wasteRouter.use(requirePermission("waste:read", "waste:log"));

// Summary must be before /:id to avoid route collision
wasteRouter.get("/summary", requirePermission("waste:read"), handleGetWasteSummary);
wasteRouter.get("/suggestions", handleGetIngredientSuggestions);
wasteRouter.post("/reuse", requirePermission("waste:read"), handleGenerateReuseSuggestions);

// CRUD: reading the list is open to both keys (a logger sees their own entries; the controller refuses
// teamView without waste:read); writing needs waste:log.
wasteRouter.post("/", requirePermission("waste:log"), handleLogWaste);
wasteRouter.get("/", handleGetWasteLogs);
wasteRouter.patch("/:id", requirePermission("waste:log"), handleEditWasteLog);
wasteRouter.delete("/:id", requirePermission("waste:log"), handleDeleteWasteLog);
