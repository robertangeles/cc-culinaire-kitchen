/**
 * @module controllers/recipeController
 *
 * Controller for the three CulinAIre Kitchen recipe labs.
 *
 * Validates the incoming request body, calls recipeService.generateRecipe,
 * and returns either a structured recipe JSON object or a prose fallback.
 *
 * All three labs share the same controller logic — the `domain` parameter
 * (injected by the route handler) determines which AI persona and prompt
 * are used.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { generateRecipe, type RecipeDomain } from "../services/recipeService.js";
import { buildContextString } from "../services/userContextService.js";

const logger = pino({ name: "recipeController" });

// ---------------------------------------------------------------------------
// Request body schema (shared across all three labs)
// ---------------------------------------------------------------------------

const RecipeRequestSchema = z.object({
  /** Free-text recipe request — the primary user intent */
  request: z.string().min(3).max(500),
  /** Servings (optional, defaults to 4) */
  servings: z.number().int().min(1).max(100).optional(),
  /** Difficulty preference */
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
  /** Dietary restrictions to always respect */
  dietary: z.array(z.string().max(50)).max(10).optional(),
  /** Recipe lab: cuisine style (e.g. "French Classical", "Japanese") */
  cuisine: z.string().max(100).optional(),
  /** Recipe lab: key ingredients to feature */
  mainIngredients: z.array(z.string().max(50)).max(20).optional(),
  /** Patisserie lab: type of pastry (tart, cake, bread, chocolate, candy) */
  pastryType: z.string().max(100).optional(),
  /** Patisserie lab: technique to showcase (lamination, tempering, etc.) */
  keyTechnique: z.string().max(100).optional(),
  /** Shared: occasion (dinner party, holiday, casual) */
  occasion: z.string().max(100).optional(),
  /** Spirits lab: spirit base or style (rum, whisky, gin, tequila, wine-based) */
  spiritBase: z.string().max(100).optional(),
  /** Spirits lab: desired flavour profile */
  flavourProfile: z.string().max(100).optional(),
  /** Spirits lab: false = mocktail / non-alcoholic */
  alcoholic: z.boolean().optional(),
});

type RecipeRequest = z.infer<typeof RecipeRequestSchema>;

// ---------------------------------------------------------------------------
// Controller factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express request handler for the given recipe domain.
 *
 * Usage in routes:
 * ```ts
 * router.post("/generate", authenticate, recipeHandler("recipe"));
 * router.post("/patisserie", authenticate, recipeHandler("patisserie"));
 * router.post("/spirits", authenticate, recipeHandler("spirits"));
 * ```
 */
export function recipeHandler(domain: RecipeDomain) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // --- Input validation ---
    const parsed = RecipeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid recipe request.",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const body: RecipeRequest = parsed.data;

    // --- Kitchen context (personalisation) ---
    const userId = req.user?.sub ?? 0;
    let kitchenContext: string | undefined;
    try {
      kitchenContext = (await buildContextString(userId)) || undefined;
    } catch (err) {
      logger.warn({ userId, err }, "recipeHandler: failed to load kitchen context — proceeding without it");
    }

    logger.info({ domain, request: body.request.slice(0, 80), userId }, "recipeHandler: generating recipe");

    // --- Generate ---
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
      });
    } catch (err) {
      logger.error({ domain, err }, "recipeHandler: unexpected error during generation");
      next(err);
      return;
    }

    // --- Respond ---
    if (result.proseResponse) {
      // Graceful degradation: prose fallback after two failed attempts
      res.status(200).json({ prose: result.proseResponse });
      return;
    }

    res.status(200).json({
      recipe: result.recipe,
      imageUrl: result.imageUrl,
    });
  };
}
