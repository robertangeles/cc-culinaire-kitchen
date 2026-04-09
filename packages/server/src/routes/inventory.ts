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
  handleGetIngredientStockLevels,
  handleAssignSupplier,
  handleListIngredientSuppliers,
  handleUpdateIngredientSupplier,
  handleRemoveIngredientSupplier,
  handleCreateSupplier,
  handleListSuppliers,
  handleUpdateSupplier,
  handleDeleteSupplier,
  handleGetSupplierLocations,
  handleBulkActivate,
  handleBulkDeactivate,
  handleCopyActivation,
  handleGetActivationStatus,
  handleGetIngredientTransactions,
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
  handleGetOrgDashboard,
  handleGetLocationDashboard,
  handleOpenOpeningCount,
} from "../controllers/stockTakeController.js";
import {
  handleRequestNewItem,
  handleListPendingRequests,
  handleApproveRequest,
  handleRejectRequest,
} from "../controllers/catalogRequestController.js";
import * as consumptionLogController from "../controllers/consumptionLogController.js";

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
router.get("/ingredients/:id/stock-levels", requirePermission("inventory:manage"), handleGetIngredientStockLevels);
router.post("/ingredients/:id/suppliers", requirePermission("inventory:manage"), handleAssignSupplier);
router.get("/ingredients/:id/suppliers", requirePermission("inventory:count"), handleListIngredientSuppliers);
router.patch("/ingredients/:id/suppliers/:supId", requirePermission("inventory:manage"), handleUpdateIngredientSupplier);
router.delete("/ingredients/:id/suppliers/:supId", requirePermission("inventory:manage"), handleRemoveIngredientSupplier);
router.get("/ingredients/:id/transactions", requirePermission("inventory:count"), handleGetIngredientTransactions);

// ─── Suppliers (org-wide) ─────────────────────────────────────────

router.post("/suppliers", requirePermission("inventory:manage"), handleCreateSupplier);
router.get("/suppliers", requirePermission("inventory:manage"), handleListSuppliers);
router.patch("/suppliers/:id", requirePermission("inventory:manage"), handleUpdateSupplier);
router.delete("/suppliers/:id", requirePermission("inventory:manage"), handleDeleteSupplier);
router.get("/suppliers/:id/locations", requirePermission("inventory:manage"), handleGetSupplierLocations);

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

// ─── Dashboards ──────────────────────────────────────────────────

router.get("/dashboard/org-summary", requirePermission("inventory:hq"), handleGetOrgDashboard);
router.get("/locations/:locId/dashboard", requirePermission("inventory:count"), handleGetLocationDashboard);

// ─── Location activation ────────────────────────────────────────

router.post("/locations/:locId/activate-items", requirePermission("inventory:manage"), handleBulkActivate);
router.post("/locations/:locId/deactivate-items", requirePermission("inventory:manage"), handleBulkDeactivate);
router.post("/locations/:locId/copy-activation", requirePermission("inventory:manage"), handleCopyActivation);
router.get("/locations/:locId/activation-status", requirePermission("inventory:count"), handleGetActivationStatus);

// ─── Opening inventory ─────────────────────────────────────────

router.post("/locations/:locId/opening-count", requirePermission("inventory:manage"), handleOpenOpeningCount);

// ─── Catalog requests ──────────────────────────────────────────

router.post("/catalog-requests", requirePermission("inventory:count"), handleRequestNewItem);
router.get("/catalog-requests/pending", requirePermission("inventory:hq"), handleListPendingRequests);
router.post("/catalog-requests/:id/approve", requirePermission("inventory:hq"), handleApproveRequest);
router.post("/catalog-requests/:id/reject", requirePermission("inventory:hq"), handleRejectRequest);

// ─── Consumption Log ─────────────────────────────────────────

router.post("/consumption-logs", requirePermission("inventory:count"), consumptionLogController.handleLogConsumption);
router.get("/consumption-logs/summary", requirePermission("inventory:hq"), consumptionLogController.handleGetSummary);
router.get("/consumption-logs", requirePermission("inventory:count"), consumptionLogController.handleListLogs);
router.patch("/consumption-logs/:id", requirePermission("inventory:count"), consumptionLogController.handleEditLog);
router.delete("/consumption-logs/:id", requirePermission("inventory:count"), consumptionLogController.handleDeleteLog);

export default router;
