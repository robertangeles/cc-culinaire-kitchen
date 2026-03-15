/**
 * @module routes/recipes
 *
 * API routes for recipe generation, management, and gallery:
 *
 *   POST   /api/recipes/generate    — Generate recipe (general culinary)
 *   POST   /api/recipes/patisserie  — Generate recipe (pastry)
 *   POST   /api/recipes/spirits     — Generate recipe (cocktails)
 *   GET    /api/recipes/gallery     — Public gallery (no auth required)
 *   GET    /api/recipes/my          — User's saved recipes (auth required)
 *   GET    /api/recipes/:id         — Single recipe by UUID
 *   PATCH  /api/recipes/:id         — Update recipe (auth required, owner only)
 *   DELETE /api/recipes/:id         — Delete recipe (auth required, owner only)
 */

import { Router } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import { authenticate } from "../middleware/auth.js";
import {
  recipeHandler,
  handleGallery,
  handleMyRecipes,
  handleGetRecipe,
  handleUpdateRecipe,
  handleDeleteRecipe,
  handleArchiveRecipe,
} from "../controllers/recipeController.js";

export const recipesRouter = Router();

// Generation endpoints (authenticated or guest)
recipesRouter.post("/generate", authenticateOrGuest, recipeHandler("recipe"));
recipesRouter.post("/patisserie", authenticateOrGuest, recipeHandler("patisserie"));
recipesRouter.post("/spirits", authenticateOrGuest, recipeHandler("spirits"));

// Gallery (public — no auth required)
recipesRouter.get("/gallery", handleGallery);

// My Recipes (auth required)
recipesRouter.get("/my", authenticate, handleMyRecipes);

// Single recipe (public recipes visible to all, private to owner only)
recipesRouter.get("/:id", authenticateOrGuest, handleGetRecipe);

// Update, Archive, Delete (auth required)
recipesRouter.patch("/:id", authenticate, handleUpdateRecipe);
recipesRouter.post("/:id/archive", authenticate, handleArchiveRecipe);
recipesRouter.delete("/:id", authenticate, handleDeleteRecipe);
