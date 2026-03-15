/**
 * @module controllers/recipeController
 *
 * Controller for the CulinAIre Kitchen recipe labs + recipe management.
 *
 * Handles:
 * - Recipe generation (POST /generate, /patisserie, /spirits)
 * - My Recipes listing (GET /my)
 * - Public gallery (GET /gallery)
 * - Single recipe (GET /:id)
 * - Update recipe (PATCH /:id)
 * - Delete recipe (DELETE /:id)
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { generateRecipe, type RecipeDomain } from "../services/recipeService.js";
import { buildContextString } from "../services/userContextService.js";
import {
  getRecipe,
  listUserRecipes,
  listGalleryRecipes,
  updateRecipe,
  deleteRecipe,
  archiveRecipe,
} from "../services/recipePersistenceService.js";

const logger = pino({ name: "recipeController" });

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const RecipeRequestSchema = z.object({
  request: z.string().min(3).max(500),
  servings: z.number().int().min(1).max(100).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
  dietary: z.array(z.string().max(50)).max(10).optional(),
  cuisine: z.string().max(100).optional(),
  mainIngredients: z.array(z.string().max(50)).max(20).optional(),
  pastryType: z.string().max(100).optional(),
  keyTechnique: z.string().max(100).optional(),
  occasion: z.string().max(100).optional(),
  spiritBase: z.string().max(100).optional(),
  flavourProfile: z.string().max(100).optional(),
  alcoholic: z.boolean().optional(),
});

type RecipeRequest = z.infer<typeof RecipeRequestSchema>;

// ---------------------------------------------------------------------------
// Generate recipe handler
// ---------------------------------------------------------------------------

export function recipeHandler(domain: RecipeDomain) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = RecipeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid recipe request.",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const body: RecipeRequest = parsed.data;
    const userId = req.user?.sub ?? 0;

    let kitchenContext: string | undefined;
    try {
      kitchenContext = (await buildContextString(userId)) || undefined;
    } catch (err) {
      logger.warn({ userId, err }, "recipeHandler: failed to load kitchen context");
    }

    logger.info({ domain, request: body.request.slice(0, 80), userId }, "recipeHandler: generating recipe");

    let result: Awaited<ReturnType<typeof generateRecipe>>;
    try {
      result = await generateRecipe({
        domain,
        request: body.request,
        servings: body.servings,
        difficulty: body.difficulty,
        dietary: body.dietary,
        cuisine: body.cuisine,
        mainIngredients: body.mainIngredients,
        pastryType: body.pastryType,
        keyTechnique: body.keyTechnique,
        occasion: body.occasion,
        spiritBase: body.spiritBase,
        flavourProfile: body.flavourProfile,
        alcoholic: body.alcoholic,
        kitchenContext,
        userId: userId > 0 ? userId : undefined,
      });
    } catch (err) {
      logger.error({ domain, err }, "recipeHandler: unexpected error during generation");
      next(err);
      return;
    }

    if (result.proseResponse) {
      res.status(200).json({ prose: result.proseResponse });
      return;
    }

    res.status(200).json({
      recipe: result.recipe,
      imageUrl: result.imageUrl,
      recipeId: result.recipeId,
      slug: result.slug,
    });
  };
}

// ---------------------------------------------------------------------------
// My Recipes
// ---------------------------------------------------------------------------

/** GET /api/recipes/my — List authenticated user's saved recipes. */
export async function handleMyRecipes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const result = await listUserRecipes(userId, page);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Gallery (public)
// ---------------------------------------------------------------------------

/** GET /api/recipes/gallery — List public recipes for the gallery. */
export async function handleGallery(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const domain = req.query.domain as string | undefined;
    const difficulty = req.query.difficulty as string | undefined;
    const search = req.query.search as string | undefined;
    const result = await listGalleryRecipes(page, 20, { domain, difficulty, search });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Single recipe
// ---------------------------------------------------------------------------

/** GET /api/recipes/:id — Get a single recipe by UUID. */
export async function handleGetRecipe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const rec = await getRecipe(id, true); // increment view count
    if (!rec) {
      res.status(404).json({ error: "Recipe not found." });
      return;
    }

    // Non-public recipes are only visible to their owner
    if (!rec.isPublicInd && rec.userId !== req.user?.sub) {
      res.status(404).json({ error: "Recipe not found." });
      return;
    }

    res.json(rec);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Update recipe
// ---------------------------------------------------------------------------

/** PATCH /api/recipes/:id — Update recipe (toggle public, edit title). */
export async function handleUpdateRecipe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const id = req.params.id as string;
    const { title, isPublicInd } = req.body;

    const updates: Record<string, unknown> = {};
    if (typeof title === "string" && title.trim()) updates.title = title.trim();
    if (typeof isPublicInd === "boolean") updates.isPublicInd = isPublicInd;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }

    const updated = await updateRecipe(id, userId, updates);
    if (!updated) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    res.json({ message: "Recipe updated." });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Delete recipe
// ---------------------------------------------------------------------------

/** DELETE /api/recipes/:id — Delete a recipe. */
export async function handleDeleteRecipe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const id = req.params.id as string;
    const deleted = await deleteRecipe(id, userId);
    if (!deleted) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    res.json({ message: "Recipe deleted." });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Archive recipe
// ---------------------------------------------------------------------------

/** POST /api/recipes/:id/archive — Archive a recipe (soft delete). */
export async function handleArchiveRecipe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const id = req.params.id as string;
    const isAdmin = req.user?.roles?.includes("Administrator") ?? false;

    const archived = await archiveRecipe(id, userId, isAdmin);
    if (!archived) {
      res.status(404).json({ error: "Recipe not found or not authorized." });
      return;
    }

    res.json({ message: "Recipe archived." });
  } catch (err) {
    next(err);
  }
}
