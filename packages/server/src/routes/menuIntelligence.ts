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
  handleGetAnalysis,
  handleRecalculate,
  handleGetCategories,
  handleUpdateCategory,
  handleImportSales,
  handleGetRecommendations,
  handleGenerateReplacement,
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

// Analysis
menuIntelligenceRouter.get("/analysis", handleGetAnalysis);
menuIntelligenceRouter.post("/analysis/recalculate", handleRecalculate);

// Categories
menuIntelligenceRouter.get("/categories", handleGetCategories);
menuIntelligenceRouter.put("/categories/:name", handleUpdateCategory);

// AI Recommendations
menuIntelligenceRouter.get("/items/:id/recommendations", handleGetRecommendations);
menuIntelligenceRouter.post("/items/:id/generate-replacement", handleGenerateReplacement);

// CSV import
menuIntelligenceRouter.post("/import-sales", upload.single("file"), handleImportSales);
