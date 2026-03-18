/**
 * @module routes/recipes
 *
 * API routes for recipe generation, management, and gallery.
 *
 * Generation routes mirror the chat route's usage tracking:
 *   authenticateOrGuest → usageCheck → generate → sessionDecrement
 */

import { Router } from "express";
import { authenticateOrGuest } from "../middleware/guestAuth.js";
import { authenticate } from "../middleware/auth.js";
import { checkUsageLimit, decrementFreeSessions } from "../middleware/usage.js";
import { checkGuestUsageLimit } from "../middleware/guestUsage.js";
import { incrementGuestSessions } from "../services/guestService.js";
import {
  recipeHandler,
  handleGallery,
  handleMyRecipes,
  handleGetRecipe,
  handleUpdateRecipe,
  handleDeleteRecipe,
  handleArchiveRecipe,
  handleEmailRecipe,
  handleRegenerateImages,
  handleMigrateImages,
} from "../controllers/recipeController.js";
import {
  handleGetRatings,
  handleSubmitRating,
  handleSubmitReview,
  handleDeleteReview,
} from "../controllers/ratingController.js";

export const recipesRouter = Router();

/**
 * Wraps a recipe generation handler with usage check + session decrement.
 * Same pattern as the chat route:
 * 1. authenticateOrGuest (already applied)
 * 2. Check usage limits (guest or authenticated)
 * 3. Run the handler
 * 4. Decrement session on success
 */
function withUsageTracking(domain: "recipe" | "patisserie" | "spirits") {
  const handler = recipeHandler(domain);

  return [
    // Usage check middleware (guest vs authenticated)
    (req: any, res: any, next: any) => {
      if (req.user) {
        checkUsageLimit(req, res, next);
      } else {
        checkGuestUsageLimit(req, res, next);
      }
    },
    // Handler + decrement
    async (req: any, res: any, next: any) => {
      let succeeded = false;
      try {
        await handler(req, res, next);
        // If response was sent successfully (not an error), mark as succeeded
        succeeded = res.statusCode >= 200 && res.statusCode < 300;
      } finally {
        if (succeeded) {
          if (req.user) {
            await decrementFreeSessions(req.user.sub).catch(() => {});
          } else if (req.guestToken) {
            await incrementGuestSessions(req.guestToken).catch(() => {});
          }
        }
      }
    },
  ];
}

// Generation endpoints with usage tracking
recipesRouter.post("/generate", authenticateOrGuest, ...withUsageTracking("recipe"));
recipesRouter.post("/patisserie", authenticateOrGuest, ...withUsageTracking("patisserie"));
recipesRouter.post("/spirits", authenticateOrGuest, ...withUsageTracking("spirits"));

// Bulk regenerate images (admin only)
recipesRouter.post("/regenerate-images", authenticate, handleRegenerateImages);
recipesRouter.post("/migrate-images", authenticate, handleMigrateImages);

// Gallery (public — no auth required)
recipesRouter.get("/gallery", handleGallery);

// My Recipes (auth required)
recipesRouter.get("/my", authenticate, handleMyRecipes);

// Single recipe (public recipes visible to all, private to owner only)
recipesRouter.get("/:id", authenticateOrGuest, handleGetRecipe);

// Update (auth or guest), Archive + Delete (auth required)
recipesRouter.patch("/:id", authenticateOrGuest, handleUpdateRecipe);
recipesRouter.post("/:id/archive", authenticate, handleArchiveRecipe);
recipesRouter.post("/:id/email", authenticateOrGuest, handleEmailRecipe);
recipesRouter.delete("/:id", authenticate, handleDeleteRecipe);

// Ratings & Reviews
recipesRouter.get("/:id/ratings", authenticateOrGuest, handleGetRatings);
recipesRouter.post("/:id/ratings", authenticate, handleSubmitRating);
recipesRouter.post("/:id/reviews", authenticate, handleSubmitReview);
recipesRouter.delete("/:id/reviews/:reviewId", authenticate, handleDeleteReview);
