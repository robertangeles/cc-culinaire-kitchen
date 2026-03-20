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
  updateRecipeContent,
  getRecipeVersions,
  getRecipeVersion,
  revertToVersion,
} from "../services/recipePersistenceService.js";
import { refineRecipe } from "../services/recipeRefinementService.js";
import { sendRecipeEmail } from "../services/emailService.js";
import { generateImage } from "../services/imageService.js";
import { db } from "../db/index.js";
import { recipe as recipeTable } from "../db/schema.js";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";

const logger = pino({ name: "recipeController" });

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const RecipeRequestSchema = z.object({
  request: z.string().min(3).max(500),
  servings: z.number().int().min(1).max(100).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
  dietary: z.array(z.string().max(50)).max(10).optional(),
  // Recipe Lab
  cuisine: z.string().max(100).optional(),
  mainIngredients: z.array(z.string().max(50)).max(20).optional(),
  // Patisserie Lab
  pastryType: z.string().max(100).optional(),
  pastryStyle: z.string().max(100).optional(),
  keyTechnique: z.string().max(100).optional(),
  componentCount: z.string().max(50).optional(),
  occasion: z.string().max(100).optional(),
  // Spirits Lab
  spiritBase: z.string().max(100).optional(),
  flavourProfile: z.string().max(100).optional(),
  alcoholic: z.boolean().optional(),
  venueType: z.string().max(100).optional(),
  drinkStyle: z.string().max(100).optional(),
  season: z.string().max(50).optional(),
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
        // Patisserie
        pastryType: body.pastryType,
        pastryStyle: body.pastryStyle,
        keyTechnique: body.keyTechnique,
        componentCount: body.componentCount,
        occasion: body.occasion,
        // Spirits
        spiritBase: body.spiritBase,
        flavourProfile: body.flavourProfile,
        alcoholic: body.alcoholic,
        venueType: body.venueType,
        drinkStyle: body.drinkStyle,
        season: body.season,
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const result = await listUserRecipes(userId, page, limit);
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const domain = req.query.domain as string | undefined;
    const difficulty = req.query.difficulty as string | undefined;
    const search = req.query.search as string | undefined;
    const result = await listGalleryRecipes(page, limit, { domain, difficulty, search });
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
    const userId = req.user?.sub ?? 0;

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

// ---------------------------------------------------------------------------
// Update recipe content (with versioning)
// ---------------------------------------------------------------------------

const UpdateContentSchema = z.object({
  recipeData: z.record(z.unknown()).optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  editorialContent: z.string().optional(),
  changeDescription: z.string().max(500).optional(),
});

/** PATCH /api/recipes/:id/content — Full recipe content update with versioning. */
export async function handleUpdateRecipeContent(
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

    const parsed = UpdateContentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid update data.",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const id = req.params.id as string;
    const result = await updateRecipeContent(id, userId, {
      recipeData: parsed.data.recipeData as Record<string, unknown> | undefined,
      title: parsed.data.title,
      description: parsed.data.description,
      editorialContent: parsed.data.editorialContent,
      changeDescription: parsed.data.changeDescription,
      changeType: "manual",
    });

    if (!result) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    res.json({ recipe: result.recipe, versionNumber: result.versionNumber });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

/** GET /api/recipes/:id/versions — List version history. */
export async function handleGetVersions(
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
    const versions = await getRecipeVersions(id, userId);

    if (versions === null) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    res.json({ versions });
  } catch (err) {
    next(err);
  }
}

/** GET /api/recipes/:id/versions/:versionId — Get a specific version. */
export async function handleGetVersion(
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
    const versionId = req.params.versionId as string;
    const version = await getRecipeVersion(id, versionId, userId);

    if (!version) {
      res.status(404).json({ error: "Version not found." });
      return;
    }

    res.json(version);
  } catch (err) {
    next(err);
  }
}

/** POST /api/recipes/:id/versions/:versionId/revert — Revert to a version. */
export async function handleRevertVersion(
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
    const versionId = req.params.versionId as string;
    const result = await revertToVersion(id, versionId, userId);

    if (!result) {
      res.status(404).json({ error: "Recipe or version not found, or not owned by you." });
      return;
    }

    res.json({ recipe: result.recipe, versionNumber: result.versionNumber });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// AI Recipe Refinement
// ---------------------------------------------------------------------------

const RefineSchema = z.object({
  instruction: z.string().min(3).max(1000),
});

/** POST /api/recipes/:id/refine — AI-refine a recipe (preview, not saved). */
export async function handleRefineRecipe(
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

    const parsed = RefineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid refinement request.",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const id = req.params.id as string;
    const rec = await getRecipe(id);
    if (!rec || rec.userId !== userId) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    const currentRecipeData = rec.recipeData as Record<string, unknown>;
    const kitchenContext = rec.kitchenContext ?? undefined;

    const result = await refineRecipe(currentRecipeData, parsed.data.instruction, kitchenContext);

    res.json({
      refinedData: result.refinedData,
      changeSummary: result.changeSummary,
    });
  } catch (err) {
    next(err);
  }
}

const AcceptRefinementSchema = z.object({
  recipeData: z.record(z.unknown()),
  changeSummary: z.string().max(1000),
});

/** POST /api/recipes/:id/accept-refinement — Save an AI refinement. */
export async function handleAcceptRefinement(
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

    const parsed = AcceptRefinementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid refinement data.",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const id = req.params.id as string;
    const result = await updateRecipeContent(id, userId, {
      recipeData: parsed.data.recipeData as Record<string, unknown>,
      changeDescription: parsed.data.changeSummary,
      changeType: "ai_refinement",
    });

    if (!result) {
      res.status(404).json({ error: "Recipe not found or not owned by you." });
      return;
    }

    res.json({ recipe: result.recipe, versionNumber: result.versionNumber });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Email recipe
// ---------------------------------------------------------------------------

const EmailSchema = z.object({
  to: z.string().email("Invalid email address"),
});

/** POST /api/recipes/:id/email — Send a formatted recipe email. */
export async function handleEmailRecipe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;

    const parsed = EmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Valid email address is required." });
      return;
    }

    const rec = await getRecipe(id);
    if (!rec) {
      res.status(404).json({ error: "Recipe not found." });
      return;
    }

    const data = rec.recipeData as Record<string, unknown>;
    const result = await sendRecipeEmail(
      parsed.data.to,
      {
        name: (data.name as string) ?? rec.title,
        description: (data.description as string) ?? "",
        hookLine: data.hookLine as string | undefined,
        yield: (data.yield as string) ?? "",
        prepTime: (data.prepTime as string) ?? "",
        cookTime: (data.cookTime as string) ?? "",
        difficulty: (data.difficulty as string) ?? "",
        temperature: data.temperature as string | undefined,
        glassware: data.glassware as string | undefined,
        garnish: data.garnish as string | undefined,
        ingredients: (data.ingredients as any[]) ?? [],
        steps: (data.steps as any[]) ?? [],
        proTips: data.proTips as string[] | undefined,
        allergenNote: (data.allergenNote as string) ?? "",
        confidenceNote: data.confidenceNote as string | undefined,
        whyThisWorks: data.whyThisWorks as string | undefined,
        theResult: data.theResult as string | undefined,
        flavorBalance: data.flavorBalance as any,
        storageAndSafety: data.storageAndSafety as string | undefined,
        platingGuide: data.platingGuide as string | undefined,
        storyBehindTheDish: data.storyBehindTheDish as string | undefined,
        textureContrast: data.textureContrast as string | undefined,
        criticalTemperatures: data.criticalTemperatures as string | undefined,
        makeAheadComponents: data.makeAheadComponents as string[] | undefined,
        winePairing: data.winePairing as any,
        abv: data.abv as string | undefined,
        standardDrinks: data.standardDrinks as string | undefined,
        buildTime: data.buildTime as string | undefined,
        ice: data.ice as string | undefined,
        venueType: data.venueType as string | undefined,
        batchSpec: data.batchSpec as any,
        variations: data.variations as any,
        foodPairing: data.foodPairing as any,
        hashtags: data.hashtags as string[] | undefined,
      },
      rec.imageUrl,
      rec.slug,
      rec.recipeId,
    );

    if (!result.sent) {
      res.status(500).json({ error: result.error ?? "Failed to send email." });
      return;
    }

    res.json({ message: "Recipe emailed successfully." });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Bulk regenerate images (admin only)
// ---------------------------------------------------------------------------

/** POST /api/recipes/regenerate-images — regenerate images for all recipes missing them */
export async function handleRegenerateImages(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Find recipes with image_prompt but no image_url
    const recipes = await db
      .select({
        recipeId: recipeTable.recipeId,
        title: recipeTable.title,
        imagePrompt: recipeTable.imagePrompt,
      })
      .from(recipeTable)
      .where(and(isNull(recipeTable.imageUrl), isNotNull(recipeTable.imagePrompt)));

    logger.info({ count: recipes.length }, "Regenerating images for recipes");

    let success = 0;
    let failed = 0;
    const results: { title: string; status: string }[] = [];

    for (const r of recipes) {
      try {
        const generated = await generateImage(r.imagePrompt!);
        if (generated?.url) {
          await db
            .update(recipeTable)
            .set({ imageUrl: generated.url })
            .where(eq(recipeTable.recipeId, r.recipeId));
          success++;
          results.push({ title: r.title, status: "ok" });
          logger.info({ recipeId: r.recipeId, title: r.title }, "Image regenerated");
        } else {
          failed++;
          results.push({ title: r.title, status: "no image returned" });
        }
      } catch (err) {
        failed++;
        results.push({ title: r.title, status: `error: ${err instanceof Error ? err.message : "unknown"}` });
        logger.warn({ err, recipeId: r.recipeId }, "Image regeneration failed");
      }
    }

    res.json({ total: recipes.length, success, failed, results });
  } catch (err) {
    next(err);
  }
}

/** POST /api/recipes/:id/regenerate-image — regenerate image for a single recipe (owner only) */
export async function handleRegenerateImage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    const recipeId = req.params.id as string;

    const [recipe] = await db
      .select({
        recipeId: recipeTable.recipeId,
        userId: recipeTable.userId,
        title: recipeTable.title,
        imagePrompt: recipeTable.imagePrompt,
        recipeData: recipeTable.recipeData,
      })
      .from(recipeTable)
      .where(eq(recipeTable.recipeId, recipeId))
      .limit(1);

    if (!recipe) {
      res.status(404).json({ error: "Recipe not found" });
      return;
    }
    if (recipe.userId !== userId) {
      res.status(403).json({ error: "Only the recipe owner can regenerate the image" });
      return;
    }

    // Prefer imagePrompt from recipeData JSONB (updated by AI Refine), fallback to table column
    const recipeDataObj = recipe.recipeData as Record<string, unknown> | null;
    const prompt = (recipeDataObj?.imagePrompt as string) || recipe.imagePrompt;

    if (!prompt) {
      res.status(400).json({ error: "No image prompt available for this recipe" });
      return;
    }

    // Also update the table column so future regenerations use the latest prompt
    if (recipeDataObj?.imagePrompt && recipeDataObj.imagePrompt !== recipe.imagePrompt) {
      await db.update(recipeTable).set({ imagePrompt: prompt }).where(eq(recipeTable.recipeId, recipeId));
    }

    const generated = await generateImage(prompt);
    if (!generated?.url) {
      res.status(500).json({ error: "Image generation failed — try again" });
      return;
    }

    await db
      .update(recipeTable)
      .set({ imageUrl: generated.url })
      .where(eq(recipeTable.recipeId, recipeId));

    logger.info({ recipeId, title: recipe.title }, "Single recipe image regenerated");
    res.json({ imageUrl: generated.url });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Migrate local images to Cloudinary (admin only)
// ---------------------------------------------------------------------------

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { uploadFileBuffer } from "../middleware/upload.js";

const __recipeDir = dirname(fileURLToPath(import.meta.url));

/** POST /api/recipes/migrate-images — upload local /uploads/ images to Cloudinary */
export async function handleMigrateImages(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Find all recipes with local image URLs
    const recipes = await db
      .select({
        recipeId: recipeTable.recipeId,
        title: recipeTable.title,
        imageUrl: recipeTable.imageUrl,
      })
      .from(recipeTable)
      .where(sql`${recipeTable.imageUrl} LIKE '/uploads/%'`);

    // Also check user photos and site settings
    const users = await db.execute(sql`SELECT user_id, user_photo_path FROM "user" WHERE user_photo_path LIKE '/uploads/%'`);
    const settings = await db.execute(sql`SELECT setting_key, setting_value FROM site_setting WHERE setting_value LIKE '/uploads/%'`);

    logger.info({ recipeCount: recipes.length, userCount: (users as any[]).length, settingCount: (settings as any[]).length }, "Migrating local images to Cloudinary");

    let success = 0;
    let failed = 0;
    const results: { type: string; name: string; status: string }[] = [];

    const rootDir = join(__recipeDir, "../../../..");

    // Migrate recipe images
    for (const r of recipes) {
      try {
        const localPath = join(rootDir, r.imageUrl!);
        const buffer = await readFile(localPath);
        const cloudUrl = await uploadFileBuffer(buffer, r.imageUrl!, "culinaire/recipes");
        await db.update(recipeTable).set({ imageUrl: cloudUrl }).where(eq(recipeTable.recipeId, r.recipeId));
        success++;
        results.push({ type: "recipe", name: r.title, status: "ok" });
      } catch (err: any) {
        failed++;
        results.push({ type: "recipe", name: r.title, status: err.message ?? "failed" });
      }
    }

    // Migrate user photos
    for (const u of users as any[]) {
      try {
        const localPath = join(rootDir, u.user_photo_path);
        const buffer = await readFile(localPath);
        const cloudUrl = await uploadFileBuffer(buffer, u.user_photo_path, "culinaire/profiles");
        await db.execute(sql`UPDATE "user" SET user_photo_path = ${cloudUrl} WHERE user_id = ${u.user_id}`);
        success++;
        results.push({ type: "user_photo", name: `user_${u.user_id}`, status: "ok" });
      } catch (err: any) {
        failed++;
        results.push({ type: "user_photo", name: `user_${u.user_id}`, status: err.message ?? "failed" });
      }
    }

    // Migrate site settings (logo, favicon)
    for (const s of settings as any[]) {
      try {
        const localPath = join(rootDir, s.setting_value);
        const buffer = await readFile(localPath);
        const cloudUrl = await uploadFileBuffer(buffer, s.setting_value, "culinaire/site");
        await db.execute(sql`UPDATE site_setting SET setting_value = ${cloudUrl} WHERE setting_key = ${s.setting_key}`);
        success++;
        results.push({ type: "setting", name: s.setting_key, status: "ok" });
      } catch (err: any) {
        failed++;
        results.push({ type: "setting", name: s.setting_key, status: err.message ?? "failed" });
      }
    }

    res.json({ total: recipes.length + (users as any[]).length + (settings as any[]).length, success, failed, results });
  } catch (err) {
    next(err);
  }
}
