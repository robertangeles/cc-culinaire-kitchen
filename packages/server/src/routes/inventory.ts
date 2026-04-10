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
  handleGetSupplierIngredientIds,
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
import * as transferController from "../controllers/transferController.js";
import * as forecastController from "../controllers/forecastController.js";
import {
  handleCreatePO,
  handleListPOs,
  handleGetPODetail,
  handleSubmitPO,
  handleReceiveLine,
  handleCancelPO,
  handleGetSuggestions,
  handleApprovePO,
  handleRejectPO,
  handleClonePO,
  handleGetThresholds,
  handleSetOrgThreshold,
  handleSetLocationThreshold,
  handleRemoveLocationThreshold,
  handleDownloadPOPdf,
} from "../controllers/purchaseOrderController.js";
import * as receivingController from "../controllers/receivingController.js";
import * as notificationController from "../controllers/notificationController.js";

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
router.get("/suppliers/:supplierId/ingredient-ids", requirePermission("inventory:count"), handleGetSupplierIngredientIds);

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

// ─── Inter-location Transfers (Wave 4) ──────────────────────────

// Collection routes first (BEFORE /:id params)
router.post("/transfers", requirePermission("inventory:manage"), transferController.handleInitiateTransfer);
router.get("/transfers", requirePermission("inventory:count"), transferController.handleListTransfers);
router.get("/transfers/pending", requirePermission("inventory:count"), transferController.handleListPending);

// Parameterized transfer routes
router.get("/transfers/:id", requirePermission("inventory:count"), transferController.handleGetTransferDetail);
router.post("/transfers/:id/send", requirePermission("inventory:manage"), transferController.handleConfirmSent);
router.post("/transfers/:id/receive", requirePermission("inventory:count"), transferController.handleConfirmReceived);
router.post("/transfers/:id/cancel", requirePermission("inventory:manage"), transferController.handleCancelTransfer);
router.put("/transfers/:id", requirePermission("inventory:manage"), transferController.handleUpdateTransfer);
router.post("/transfers/:id/lines", requirePermission("inventory:manage"), transferController.handleAddLines);

// ─── AI Forecasting (Wave 5) ────────────────────────────────────

router.get("/forecasts", requirePermission("inventory:manage"), forecastController.handleListRecommendations);
router.post("/forecasts/generate", requirePermission("inventory:hq"), forecastController.handleGenerateForecasts);
router.post("/forecasts/:id/dismiss", requirePermission("inventory:manage"), forecastController.handleDismiss);
router.post("/forecasts/:id/ordered", requirePermission("inventory:manage"), forecastController.handleMarkOrdered);

// ─── Purchase Orders (Wave 3) ─────────────────────────────────────

// Collection routes first (BEFORE /:id params)
router.post("/purchase-orders", requirePermission("inventory:manage"), handleCreatePO);
router.get("/purchase-orders", requirePermission("inventory:count"), handleListPOs);
router.get("/purchase-orders/suggestions", requirePermission("inventory:manage"), handleGetSuggestions);

// Parameterized PO routes
router.get("/purchase-orders/:id", requirePermission("inventory:count"), handleGetPODetail);
router.post("/purchase-orders/:id/submit", requirePermission("purchasing:submit"), handleSubmitPO);
router.post("/purchase-orders/:id/approve", requirePermission("purchasing:approve"), handleApprovePO);
router.post("/purchase-orders/:id/reject", requirePermission("purchasing:approve"), handleRejectPO);
router.post("/purchase-orders/:id/clone", requirePermission("purchasing:draft"), handleClonePO);
router.get("/purchase-orders/:id/pdf", requirePermission("purchasing:submit"), handleDownloadPOPdf);
router.post("/purchase-orders/:id/cancel", requirePermission("inventory:manage"), handleCancelPO);
router.post("/purchase-orders/:id/lines/:lineId/receive", requirePermission("inventory:count"), handleReceiveLine);

// ─── Spend Thresholds ────────────────────────────────────────────

router.get("/thresholds", requirePermission("purchasing:approve"), handleGetThresholds);
router.put("/thresholds/org", requirePermission("purchasing:approve"), handleSetOrgThreshold);
router.put("/thresholds/location", requirePermission("purchasing:approve"), handleSetLocationThreshold);
router.delete("/thresholds/location/:locationId", requirePermission("purchasing:approve"), handleRemoveLocationThreshold);

// ─── Delivery Receiving ──────────────────────────────────────────

router.post("/receiving/sessions", requirePermission("purchasing:receive"), receivingController.handleStartSession);
router.get("/receiving/sessions/:sessionId", requirePermission("purchasing:receive"), receivingController.handleGetSession);
router.post("/receiving/sessions/:sessionId/lines/:lineId", requirePermission("purchasing:receive"), receivingController.handleActionLine);
router.post("/receiving/sessions/:sessionId/confirm", requirePermission("purchasing:receive"), receivingController.handleConfirmReceipt);
router.post("/receiving/sessions/:sessionId/cancel", requirePermission("purchasing:receive"), receivingController.handleCancelSession);

// ─── Credit Notes ────────────────────────────────────────────────

router.post("/credit-notes", requirePermission("purchasing:credit"), receivingController.handleCreateCreditNote);
router.get("/credit-notes", requirePermission("purchasing:credit"), receivingController.handleGetCreditNotes);

// ─── Notifications ───────────────────────────────────────────────

router.get("/notifications", notificationController.handleGetUnread);
router.get("/notifications/count", notificationController.handleGetUnreadCount);
router.patch("/notifications/:id/read", notificationController.handleMarkAsRead);
router.patch("/notifications/:id/dismiss", notificationController.handleDismiss);

export default router;
