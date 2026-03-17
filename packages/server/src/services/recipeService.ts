/**
 * @module recipeService
 *
 * AI recipe generation service for the CulinAIre Kitchen recipe labs.
 * V2: Enhanced with RAG knowledge search, editorial depth, virality
 * elements, and automatic persistence to the recipe table.
 *
 * ## Pipeline
 *  1. Load kitchen context (user's skill, equipment, dietary)
 *  2. RAG search for relevant culinary knowledge (flavor pairings, techniques)
 *  3. Generate structured recipe via generateObject + enhanced Zod schema
 *  4. Generate hero image (non-fatal)
 *  5. Persist to database → return recipe with UUID
 *
 * ## Failure handling
 *  1. Attempt structured generation → success → persist + return
 *  2. Retry with stricter prompt → success → persist + return
 *  3. Final fallback → prose response (not persisted)
 */

import { generateObject } from "ai";
import { z } from "zod";
import pino from "pino";
import { getModel } from "./providerService.js";
import { generateImage } from "./imageService.js";
import { getAllSettings } from "./settingsService.js";
import { searchKnowledge } from "./knowledgeService.js";
import { saveRecipe } from "./recipePersistenceService.js";
import { getPromptRaw } from "./promptService.js";

const logger = pino({ name: "recipeService" });

// ---------------------------------------------------------------------------
// Domain type
// ---------------------------------------------------------------------------

export type RecipeDomain = "recipe" | "patisserie" | "spirits";

// ---------------------------------------------------------------------------
// Zod output schema (V2 — enhanced)
// ---------------------------------------------------------------------------

const IngredientSchema = z.object({
  amount: z.string(),
  unit: z.string(),
  name: z.string(),
  note: z.string().optional(),
});

const StepSchema = z.object({
  step: z.number().int().positive(),
  instruction: z.string(),
});

const FlavorScoreSchema = z.object({
  score: z.number().min(0).max(10),
  description: z.string(),
});

const NutritionSchema = z.object({
  nutrient: z.string(),
  amount: z.string(),
  dailyValue: z.string().optional(),
});

const WinePairingPrimarySchema = z.object({
  wine: z.string(),
  intensityMatch: z.number().optional(),
  flavorHarmony: z.number().optional(),
  textureInteraction: z.number().optional(),
  why: z.string(),
});

const WinePairingSchema = z.object({
  primary: WinePairingPrimarySchema,
  alternatives: z.array(z.object({ wine: z.string(), why: z.string() })).optional(),
});

/**
 * Enhanced recipe output schema (V2).
 * Includes editorial depth, flavor balance, nutrition, virality elements,
 * and optional wine pairing.
 */
export const RecipeOutputSchema = z.object({
  // Core fields
  name: z.string(),
  description: z.string(),
  yield: z.string(),
  prepTime: z.string(),
  cookTime: z.string(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  proTips: z.array(z.string()).optional(),
  allergenNote: z.string(),
  imagePrompt: z.string(),
  confidenceNote: z.string(),

  // Domain-specific (optional)
  temperature: z.string().optional(),
  glassware: z.string().optional(),
  garnish: z.string().optional(),
  alcoholic: z.boolean().optional(),

  // Editorial depth (V2)
  whyThisWorks: z.string().optional(),
  theResult: z.string().optional(),
  flavorBalance: z.object({
    sweet: FlavorScoreSchema,
    salty: FlavorScoreSchema,
    sour: FlavorScoreSchema,
    bitter: FlavorScoreSchema,
    umami: FlavorScoreSchema,
  }).optional(),
  nutritionPerServing: z.array(NutritionSchema).optional(),
  storageAndSafety: z.string().optional(),

  // Virality (V2)
  hookLine: z.string().optional(),
  storyBehindTheDish: z.string().optional(),
  platingGuide: z.string().optional(),
  hashtags: z.array(z.string()).optional(),

  // Wine pairing (V2, optional — null for spirits domain)
  winePairing: WinePairingSchema.optional().nullable(),

  // Patisserie-specific (V2)
  bakerPercentages: z.array(z.object({
    ingredient: z.string(),
    weight: z.string(),
    percentage: z.string(),
  })).optional(),
  textureContrast: z.string().optional(),
  makeAheadComponents: z.array(z.string()).optional(),
  criticalTemperatures: z.string().optional(),

  // Spirits-specific (V2) — lenient types to handle AI output variations
  venueType: z.string().optional(),
  buildTime: z.string().optional(),
  ice: z.string().optional(),
  abv: z.string().optional(),
  standardDrinks: z.string().optional(),
  batchSpec: z.object({
    servings: z.union([z.number(), z.string()]),
    components: z.array(z.string()),
    storage: z.string(),
    toServe: z.string(),
  }).optional().nullable(),
  variations: z.array(z.object({
    name: z.string(),
    description: z.string(),
    specAdjustment: z.string().optional(),
  })).optional().nullable(),
  foodPairing: z.object({
    primary: z.object({ dish: z.string(), why: z.string() }),
    alternatives: z.array(z.object({ dish: z.string(), why: z.string() })).optional(),
  }).optional().nullable(),
});

export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;

// ---------------------------------------------------------------------------
// Recipe input
// ---------------------------------------------------------------------------

export interface RecipeInput {
  domain: RecipeDomain;
  request: string;
  dietary?: string[];
  servings?: number;
  difficulty?: string;
  cuisine?: string;
  mainIngredients?: string[];
  /** Patisserie fields */
  pastryType?: string;
  pastryStyle?: string;
  keyTechnique?: string;
  componentCount?: string;
  occasion?: string;
  /** Spirits fields */
  spiritBase?: string;
  flavourProfile?: string;
  alcoholic?: boolean;
  venueType?: string;
  drinkStyle?: string;
  season?: string;
  kitchenContext?: string;
  /** User ID for persistence (null for guests) */
  userId?: number;
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

/** Maps recipe domain to the prompt name stored in the database. */
const PROMPT_NAMES: Record<RecipeDomain, string> = {
  recipe: "recipePrompt",
  patisserie: "patisseriePrompt",
  spirits: "spiritsPrompt",
};

/** Load a domain-specific recipe prompt from the database (via promptService). */
async function loadDomainPrompt(domain: RecipeDomain): Promise<string> {
  return getPromptRaw(PROMPT_NAMES[domain]);
}

// ---------------------------------------------------------------------------
// RAG knowledge search
// ---------------------------------------------------------------------------

/**
 * Search the knowledge base for relevant culinary context based on the
 * user's recipe request. Returns formatted reference text to inject
 * into the generation prompt.
 */
async function searchRecipeContext(input: RecipeInput): Promise<string> {
  try {
    // Build search query from request + key ingredients + cuisine
    const searchTerms = [input.request];
    if (input.mainIngredients?.length) searchTerms.push(...input.mainIngredients);
    if (input.cuisine) searchTerms.push(input.cuisine);
    if (input.spiritBase) searchTerms.push(input.spiritBase);

    const query = searchTerms.join(" ");
    const results = await searchKnowledge(query);

    if (results.length === 0) return "";

    const context = results
      .slice(0, 3)
      .map((r) => r.snippet)
      .join("\n\n");

    logger.debug({ resultCount: results.length }, "RAG context loaded for recipe generation");

    return `\n## Culinary Reference (use as inspiration, do not cite):\n${context}\n`;
  } catch (err) {
    logger.warn({ err }, "RAG search failed for recipe context — proceeding without");
    return "";
  }
}

// ---------------------------------------------------------------------------
// User message builder
// ---------------------------------------------------------------------------

function buildUserMessage(input: RecipeInput, ragContext: string): string {
  const parts: string[] = [];

  if (input.kitchenContext) {
    parts.push(input.kitchenContext);
    parts.push("");
  }

  if (ragContext) {
    parts.push(ragContext);
    parts.push("");
  }

  parts.push(`Create a ${input.domain === "spirits" ? "drink" : "recipe"}: ${input.request}`);
  parts.push("IMPORTANT: The recipe name must be the dish name only. Never include restaurant names, business names, brand names, or establishment names in the recipe title.");

  if (input.servings) parts.push(`Servings: ${input.servings}`);
  if (input.difficulty) parts.push(`Difficulty: ${input.difficulty}`);
  if (input.dietary && input.dietary.length > 0) {
    parts.push(`Dietary restrictions to respect: ${input.dietary.join(", ")}`);
  }

  if (input.domain === "recipe") {
    if (input.cuisine) parts.push(`Cuisine style: ${input.cuisine}`);
    if (input.mainIngredients && input.mainIngredients.length > 0) {
      parts.push(`Key ingredients to feature: ${input.mainIngredients.join(", ")}`);
    }
  } else if (input.domain === "patisserie") {
    if (input.pastryStyle) parts.push(`Pastry style: ${input.pastryStyle}`);
    if (input.pastryType) parts.push(`Pastry type: ${input.pastryType}`);
    if (input.keyTechnique) parts.push(`Key technique to showcase: ${input.keyTechnique}`);
    if (input.componentCount) parts.push(`Complexity: ${input.componentCount}`);
    if (input.occasion) parts.push(`Occasion: ${input.occasion}`);
  } else if (input.domain === "spirits") {
    if (input.venueType) parts.push(`Venue type: ${input.venueType}`);
    if (input.spiritBase) parts.push(`Spirit base: ${input.spiritBase}`);
    if (input.drinkStyle) parts.push(`Drink style: ${input.drinkStyle}`);
    if (input.flavourProfile) parts.push(`Flavour profile: ${input.flavourProfile}`);
    if (input.season) parts.push(`Season: ${input.season}`);
    if (input.occasion) parts.push(`Occasion: ${input.occasion}`);
    if (input.alcoholic === false) parts.push("Make this non-alcoholic (mocktail/zero-proof).");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Prose fallback
// ---------------------------------------------------------------------------

function proseFallback(input: RecipeInput): string {
  const examples: Record<RecipeDomain, string> = {
    recipe: '"braised chicken thighs with cider"',
    patisserie: '"dark chocolate tart with raspberry"',
    spirits: '"autumn whiskey sour with honey"',
  };
  const labels: Record<RecipeDomain, string> = {
    recipe: "recipe",
    patisserie: "pastry recipe",
    spirits: "drink recipe",
  };

  return (
    `I wasn't able to generate a structured ${labels[input.domain]} for "${input.request}" right now. ` +
    `Here are some suggestions to get you started:\n\n` +
    `- Try simplifying your request (e.g. ${examples[input.domain]} instead of multiple constraints at once)\n` +
    `- Check that your request is specific enough for a single ${labels[input.domain]}\n` +
    `- Try again in a moment if the AI service is under load\n\n` +
    `If the issue persists, ask the CulinAIre Kitchen chat assistant — it can help you build a ${labels[input.domain]} through conversation.`
  );
}

// ---------------------------------------------------------------------------
// Core generation (V2)
// ---------------------------------------------------------------------------

/**
 * Generate a structured recipe, persist it to the database, and return
 * the recipe with its shareable UUID.
 */
export async function generateRecipe(input: RecipeInput): Promise<{
  recipe: RecipeOutput | null;
  imageUrl: string | null;
  proseResponse: string | null;
  recipeId: string | null;
  slug: string | null;
}> {
  let systemPrompt: string;
  try {
    systemPrompt = await loadDomainPrompt(input.domain);
  } catch (err) {
    logger.error({ err, domain: input.domain }, "generateRecipe: failed to load domain prompt");
    return { recipe: null, imageUrl: null, proseResponse: proseFallback(input), recipeId: null, slug: null };
  }

  // RAG knowledge search — inject relevant culinary context
  const ragContext = await searchRecipeContext(input);

  const model = getModel();
  const userMessage = buildUserMessage(input, ragContext);

  // Attempt 1
  let recipe: RecipeOutput | null = null;
  try {
    const { object } = await generateObject({
      model,
      schema: RecipeOutputSchema,
      system: systemPrompt,
      prompt: userMessage,
    });
    recipe = object;
    logger.info({ domain: input.domain, recipeName: recipe.name }, "generateRecipe: structured generation succeeded");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ domain: input.domain, error: msg }, "generateRecipe: attempt 1 failed — retrying");

    // Attempt 2 — stricter prompt
    const stricterMessage = `${userMessage}\n\nIMPORTANT: Return ONLY a valid JSON object matching the schema exactly. No markdown, no commentary, no code fences.`;
    try {
      const { object } = await generateObject({
        model,
        schema: RecipeOutputSchema,
        system: systemPrompt,
        prompt: stricterMessage,
      });
      recipe = object;
      logger.info({ domain: input.domain, recipeName: recipe.name }, "generateRecipe: retry succeeded");
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.error({ domain: input.domain, error: retryMsg }, "generateRecipe: retry also failed — prose fallback");
      return { recipe: null, imageUrl: null, proseResponse: proseFallback(input), recipeId: null, slug: null };
    }
  }

  // Generate hero image (non-fatal)
  let imageUrl: string | null = null;
  const settings = await getAllSettings();
  if (settings.image_generation_enabled === "true" && recipe.imagePrompt) {
    try {
      const generated = await generateImage(recipe.imagePrompt);
      imageUrl = generated?.url ?? null;
      logger.info({ imageUrl }, "generateRecipe: hero image generated");
    } catch (imgErr) {
      logger.warn({ err: imgErr }, "generateRecipe: image generation failed — no hero image");
    }
  }

  // Persist recipe to database
  let recipeId: string | null = null;
  let slug: string | null = null;
  try {
    const saved = await saveRecipe({
      userId: input.userId,
      domain: input.domain,
      title: recipe.name,
      description: recipe.description,
      recipeData: recipe as unknown as Record<string, unknown>,
      imageUrl: imageUrl ?? undefined,
      imagePrompt: recipe.imagePrompt,
      kitchenContext: input.kitchenContext,
      requestParams: {
        request: input.request,
        servings: input.servings,
        difficulty: input.difficulty,
        dietary: input.dietary,
        cuisine: input.cuisine,
        mainIngredients: input.mainIngredients,
      },
    });
    recipeId = saved.recipeId;
    slug = saved.slug;
    logger.info({ recipeId, slug, title: recipe.name }, "generateRecipe: recipe persisted");
  } catch (err) {
    logger.warn({ err }, "generateRecipe: failed to persist recipe — returning without ID");
  }

  return { recipe, imageUrl, proseResponse: null, recipeId, slug };
}
