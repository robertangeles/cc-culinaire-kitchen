/**
 * @module routes/inventory
 *
 * REST endpoints for the Inventory System — Phase 1:
 * ingredient catalog, unit conversions, stock take workflow,
 * and location dashboard.
 *
 * All routes require authentication. Permission-gated by:
 *   inventory:count   — basic counting access
 *   inventory:manage  — open sessions, set par levels, manage catalog
 *   inventory:hq      — approve/flag sessions, cross-location view
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  handleCreateIngredient,
  handleListIngredients,
  handleUpdateIngredient,
  handleAddConversion,
  handleListConversions,
  handleDeleteConversion,
  handleListLocationIngredients,
  handleUpdateLocationIngredient,
} from "../controllers/ingredientController.js";
import {
  handleOpenSession,
  handleGetActiveSession,
  handleGetSessionDetail,
  handleClaimCategory,
  handleSaveLineItem,
  handleGetCategoryLines,
  handleSubmitCategory,
  handleSubmitForReview,
  handleApproveSession,
  handleFlagSession,
  handleGetPreviousLines,
  handleGetPendingReviews,
  handleGetLocationDashboard,
} from "../controllers/stockTakeController.js";

const router = Router();
router.use(authenticate);

// ─── Ingredient catalog (org-wide) ────────────────────────────────

// Collection routes first (before /:id params)
router.post("/ingredients", requirePermission("inventory:manage"), handleCreateIngredient);
router.get("/ingredients", requirePermission("inventory:count"), handleListIngredients);

// Parameterized ingredient routes
router.patch("/ingredients/:id", requirePermission("inventory:manage"), handleUpdateIngredient);
router.post("/ingredients/:id/conversions", requirePermission("inventory:manage"), handleAddConversion);
router.get("/ingredients/:id/conversions", requirePermission("inventory:count"), handleListConversions);
router.delete("/ingredients/:id/conversions/:conversionId", requirePermission("inventory:manage"), handleDeleteConversion);

// ─── Location ingredient config ───────────────────────────────────

router.get("/locations/:locId/ingredients", requirePermission("inventory:count"), handleListLocationIngredients);
router.patch("/locations/:locId/ingredients/:id", requirePermission("inventory:manage"), handleUpdateLocationIngredient);

// ─── Stock take sessions ──────────────────────────────────────────

// Collection routes first (BEFORE /:id params)
router.post("/stock-takes", requirePermission("inventory:manage"), handleOpenSession);
router.get("/stock-takes/active", requirePermission("inventory:count"), handleGetActiveSession);
router.get("/stock-takes/pending-reviews", requirePermission("inventory:hq"), handleGetPendingReviews);

// Parameterized session routes
router.get("/stock-takes/:id", requirePermission("inventory:count"), handleGetSessionDetail);
router.post("/stock-takes/:id/submit-for-review", requirePermission("inventory:count"), handleSubmitForReview);
router.post("/stock-takes/:id/approve", requirePermission("inventory:hq"), handleApproveSession);
router.post("/stock-takes/:id/flag", requirePermission("inventory:hq"), handleFlagSession);

// Category actions within a session
router.post("/stock-takes/:id/categories/:cat/claim", requirePermission("inventory:count"), handleClaimCategory);
router.post("/stock-takes/:id/categories/:cat/lines", requirePermission("inventory:count"), handleSaveLineItem);
router.get("/stock-takes/:id/categories/:cat/lines", requirePermission("inventory:count"), handleGetCategoryLines);
router.post("/stock-takes/:id/categories/:cat/submit", requirePermission("inventory:count"), handleSubmitCategory);

// Copy Last Count pre-fill
router.get("/stock-takes/:id/previous-lines/:cat", requirePermission("inventory:count"), handleGetPreviousLines);

// ─── Location dashboard ──────────────────────────────────────────

router.get("/locations/:locId/dashboard", requirePermission("inventory:count"), handleGetLocationDashboard);

export default router;
