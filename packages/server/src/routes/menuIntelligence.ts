/**
 * @module routes/menuIntelligence
 *
 * REST routes for Menu Intelligence.
 * All routes require authentication.
 */

import { Router } from "express";
import multer from "multer";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { locationParamGuard } from "../middleware/locationAccess.js";
import {
  handleListMenuItems,
  handleCreateMenuItem,
  handleUpdateMenuItem,
  handleDeleteMenuItem,
  handleAddIngredient,
  handleListIngredients,
  handleDeleteIngredient,
  handleRefreshCost,
  handleGetPandLCost,
  handleGetAnalysis,
  handleRecalculate,
  handleGetCategories,
  handleUpdateCategory,
  handleImportSales,
  handleGetRecommendations,
  handleGenerateReplacement,
  handleGetWasteImpact,
  handleGetYieldVariance,
  handleListYieldVariance,
  handleRecordSale,
  handleVoidSale,
  handleListSales,
  handleSalesCsvPreview,
  handleSalesCsvCommit,
  handleListConsumables,
  handleRecordConsumableSale,
} from "../controllers/menuIntelligenceController.js";

export const menuIntelligenceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

menuIntelligenceRouter.use(authenticate);
menuIntelligenceRouter.param("locId", locationParamGuard);
// menu:read opens the module: reading, and recording a sale (any member who may sell can sell any item).
// menu:manage, on top of it, edits the menu, voids a sale and runs the paid model call.
menuIntelligenceRouter.use(requirePermission("menu:read"));
const manage = requirePermission("menu:manage");

// Recipe-based selling: record a sale (explodes recipe → deducts stock),
// void a sale, and list a location's sales.
menuIntelligenceRouter.post("/items/:id/sales", handleRecordSale);
menuIntelligenceRouter.post("/sales/:saleId/void", manage, handleVoidSale);
menuIntelligenceRouter.get("/locations/:locId/sales", handleListSales);
menuIntelligenceRouter.post("/sales/import/preview", upload.single("file"), handleSalesCsvPreview);
menuIntelligenceRouter.post("/sales/import/commit", handleSalesCsvCommit);
// FOH consumables sell directly (auto 1:1 link — no hand-built menu item per can)
menuIntelligenceRouter.get("/consumables", handleListConsumables);
menuIntelligenceRouter.post("/consumables/:ingredientId/sales", handleRecordConsumableSale);

// Menu items
menuIntelligenceRouter.get("/items", handleListMenuItems);
menuIntelligenceRouter.post("/items", manage, handleCreateMenuItem);
menuIntelligenceRouter.patch("/items/:id", manage, handleUpdateMenuItem);
menuIntelligenceRouter.delete("/items/:id", manage, handleDeleteMenuItem);

// Ingredients per item
menuIntelligenceRouter.get("/items/:id/ingredients", handleListIngredients);
menuIntelligenceRouter.post("/items/:id/ingredients", manage, handleAddIngredient);
menuIntelligenceRouter.delete("/items/:id/ingredients/:ingredientId", manage, handleDeleteIngredient);

// Catalog-spine Phase 3: refresh stale cost from Catalog + per-location P&L cost
menuIntelligenceRouter.post("/items/:id/ingredients/:ingredientId/refresh-cost", manage, handleRefreshCost);
menuIntelligenceRouter.get("/items/:id/pandl-cost", handleGetPandLCost);

// Analysis
menuIntelligenceRouter.get("/analysis", handleGetAnalysis);
menuIntelligenceRouter.post("/analysis/recalculate", manage, handleRecalculate);

// Categories
menuIntelligenceRouter.get("/categories", handleGetCategories);
menuIntelligenceRouter.put("/categories/:name", manage, handleUpdateCategory);

// AI Recommendations
menuIntelligenceRouter.get("/items/:id/recommendations", manage, handleGetRecommendations);
menuIntelligenceRouter.post("/items/:id/generate-replacement", handleGenerateReplacement);

// Cross-module: Waste impact per menu item
menuIntelligenceRouter.get("/waste-impact", handleGetWasteImpact);

// CSV import
menuIntelligenceRouter.post("/import-sales", manage, upload.single("file"), handleImportSales);

// Phase 4a — Yield variance
menuIntelligenceRouter.get("/yield-variance", handleListYieldVariance);
menuIntelligenceRouter.get("/items/:id/yield-variance", handleGetYieldVariance);

