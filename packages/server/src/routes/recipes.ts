/**
 * @module routes/recipes
 *
 * API routes for the three CulinAIre Kitchen recipe labs:
 *
 *   POST /api/recipes/generate   — CulinAIre Recipe (general culinary)
 *   POST /api/recipes/patisserie — CulinAIre Patisserie (pastry/baked goods)
 *   POST /api/recipes/spirits    — CulinAIre Spirits (cocktails/mocktails)
 *
 * All routes accept both authenticated users and guest sessions (same as chat).
 * Authenticated users get kitchen profile context injected into the generation;
 * guests receive generic responses without personalisation.
 *
 * The general app-level rate limit (60 req/min) covers these endpoints.
 * Kitchen profile context is loaded server-side so it cannot be spoofed.
 */

import { Router } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import { recipeHandler } from "../controllers/recipeController.js";

export const recipesRouter = Router();

/**
 * POST /api/recipes/generate
 * CulinAIre Recipe Lab — general culinary across all cuisines and techniques.
 */
recipesRouter.post("/generate", authenticateOrGuest, recipeHandler("recipe"));

/**
 * POST /api/recipes/patisserie
 * CulinAIre Patisserie Lab — pastry, baked goods, confectionery, chocolate.
 */
recipesRouter.post("/patisserie", authenticateOrGuest, recipeHandler("patisserie"));

/**
 * POST /api/recipes/spirits
 * CulinAIre Spirits Lab — cocktails, mocktails, alcoholic and non-alcoholic beverages.
 */
recipesRouter.post("/spirits", authenticateOrGuest, recipeHandler("spirits"));
