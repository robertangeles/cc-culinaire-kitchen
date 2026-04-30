/**
 * @module routes/menuIntelligence
 *
 * REST routes for Menu Intelligence.
 * All routes require authentication.
 */

import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth.js";
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
} from "../controllers/menuIntelligenceController.js";

export const menuIntelligenceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

menuIntelligenceRouter.use(authenticate);

// Menu items
menuIntelligenceRouter.get("/items", handleListMenuItems);
menuIntelligenceRouter.post("/items", handleCreateMenuItem);
menuIntelligenceRouter.patch("/items/:id", handleUpdateMenuItem);
menuIntelligenceRouter.delete("/items/:id", handleDeleteMenuItem);

// Ingredients per item
menuIntelligenceRouter.get("/items/:id/ingredients", handleListIngredients);
menuIntelligenceRouter.post("/items/:id/ingredients", handleAddIngredient);
menuIntelligenceRouter.delete("/items/:id/ingredients/:ingredientId", handleDeleteIngredient);

// Catalog-spine Phase 3: refresh stale cost from Catalog + per-location P&L cost
menuIntelligenceRouter.post("/items/:id/ingredients/:ingredientId/refresh-cost", handleRefreshCost);
menuIntelligenceRouter.get("/items/:id/pandl-cost", handleGetPandLCost);

// Analysis
menuIntelligenceRouter.get("/analysis", handleGetAnalysis);
menuIntelligenceRouter.post("/analysis/recalculate", handleRecalculate);

// Categories
menuIntelligenceRouter.get("/categories", handleGetCategories);
menuIntelligenceRouter.put("/categories/:name", handleUpdateCategory);

// AI Recommendations
menuIntelligenceRouter.get("/items/:id/recommendations", handleGetRecommendations);
menuIntelligenceRouter.post("/items/:id/generate-replacement", handleGenerateReplacement);

// Cross-module: Waste impact per menu item
menuIntelligenceRouter.get("/waste-impact", handleGetWasteImpact);

// CSV import
menuIntelligenceRouter.post("/import-sales", upload.single("file"), handleImportSales);
