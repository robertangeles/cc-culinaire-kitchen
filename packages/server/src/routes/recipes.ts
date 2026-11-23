/**
 * @module routes/recipes
 *
 * API routes for recipe generation, management, and gallery.
 *
 * Generation routes mirror the chat route's usage tracking:
 *   authenticateOrGuest → rate limit → usageCheck → generate → charge a session if a recipe was made
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { checkSessionQuota, chargeSession } from "../middleware/usage.js";
import {
  recipeGenerateRateLimit,
  recipeRefineRateLimit,
  recipeImageRateLimit,
  recipeEmailRateLimit,
  recipeEmailRecipientRateLimit,
} from "../middleware/rateLimiter.js";
import {
  recipeHandler,
  handleGallery,
  handleMyRecipes,
  handleGetRecipe,
  handleUpdateRecipe,
  handleUpdateRecipeContent,
  handleDeleteRecipe,
  handleArchiveRecipe,
  handleEmailRecipe,
  handleRegenerateImages,
  handleMigrateImages,
  handleGetVersions,
  handleGetVersion,
  handleRevertVersion,
  handleRefineRecipe,
  handleAcceptRefinement,
  handleRegenerateImage,
  handleGetRecipesForImport,
} from "../controllers/recipeController.js";
import {
  handleGetRatings,
  handleSubmitRating,
  handleSubmitReview,
  handleDeleteReview,
} from "../controllers/ratingController.js";

export const recipesRouter = Router();

/**
 * Wraps a recipe generation handler with the usage check and the charge:
 * 1. authenticateOrGuest (already applied)
 * 2. Check usage limits (guest or authenticated)
 * 3. Run the handler
 * 4. Charge a session only if the handler says it produced a recipe
 */
function withUsageTracking(domain: "recipe" | "patisserie" | "spirits") {
  const handler = recipeHandler(domain);

  return [
    checkSessionQuota,
    async (req: Request, res: Response, next: NextFunction) => {
      if (await handler(req, res, next)) await chargeSession(req);
    },
  ];
}

// Generation endpoints with usage tracking
recipesRouter.post("/generate", authenticateOrGuest, recipeGenerateRateLimit, ...withUsageTracking("recipe"));
recipesRouter.post("/patisserie", authenticateOrGuest, recipeGenerateRateLimit, ...withUsageTracking("patisserie"));
recipesRouter.post("/spirits", authenticateOrGuest, recipeGenerateRateLimit, ...withUsageTracking("spirits"));

// Bulk regenerate images (admin only)
// Admin-only maintenance jobs — these mutate images/settings across ALL tenants.
recipesRouter.post("/regenerate-images", authenticate, requireRole("Administrator"), handleRegenerateImages);
recipesRouter.post("/migrate-images", authenticate, requireRole("Administrator"), handleMigrateImages);

// Lightweight recipe list for menu-item import
recipesRouter.get("/for-import", authenticate, handleGetRecipesForImport);

// Gallery (public — no auth required)
recipesRouter.get("/gallery", handleGallery);

// My Recipes (auth required)
recipesRouter.get("/my", authenticate, handleMyRecipes);

// Version management & AI refinement (auth required, before /:id catch-all)
recipesRouter.get("/:id/versions", authenticate, handleGetVersions);
recipesRouter.get("/:id/versions/:versionId", authenticate, handleGetVersion);
recipesRouter.post("/:id/versions/:versionId/revert", authenticate, handleRevertVersion);
recipesRouter.patch("/:id/content", authenticate, handleUpdateRecipeContent);
recipesRouter.post("/:id/refine", authenticate, recipeRefineRateLimit, handleRefineRecipe);
recipesRouter.post("/:id/accept-refinement", authenticate, handleAcceptRefinement);
recipesRouter.post("/:id/regenerate-image", authenticate, recipeImageRateLimit, handleRegenerateImage);

// Single recipe (public recipes visible to all, private to owner only)
recipesRouter.get("/:id", authenticateOrGuest, handleGetRecipe);

// Update (auth or guest), Archive + Delete (auth required)
recipesRouter.patch("/:id", authenticateOrGuest, handleUpdateRecipe);
recipesRouter.post("/:id/archive", authenticate, handleArchiveRecipe);
recipesRouter.post("/:id/email", authenticateOrGuest, recipeEmailRateLimit, recipeEmailRecipientRateLimit, handleEmailRecipe);
recipesRouter.delete("/:id", authenticate, handleDeleteRecipe);

// Ratings & Reviews
recipesRouter.get("/:id/ratings", authenticateOrGuest, handleGetRatings);
recipesRouter.post("/:id/ratings", authenticate, handleSubmitRating);
recipesRouter.post("/:id/reviews", authenticate, handleSubmitReview);
recipesRouter.delete("/:id/reviews/:reviewId", authenticate, handleDeleteReview);
