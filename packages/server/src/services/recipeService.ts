/**
 * @module recipeService
 *
 * AI recipe generation service for the three CulinAIre Kitchen recipe labs:
 *  - CulinAIre Recipe  (general culinary, all cuisines + techniques)
 *  - CulinAIre Patisserie (pastry, baked goods, confectionery, chocolate)
 *  - CulinAIre Spirits (cocktails, mocktails, alcoholic/non-alcoholic beverages)
 *
 * All three labs share this service via the `domain` parameter.  Each domain
 * loads its own system prompt from `prompts/recipe/` and produces a structured
 * JSON recipe via Vercel AI SDK `generateObject` with a shared Zod schema (plus
 * domain-specific optional fields).
 *
 * ## Failure handling
 *  1. Attempt structured generation (generateObject) — success → return recipe
 *  2. If structured generation fails (JSON parse error, schema mismatch, API
 *     timeout, rate limit) → retry ONCE with a stricter prompt
 *  3. If retry also fails → return a prose fallback so the user gets something
 *     useful rather than a blank error screen
 *
 * ## Image generation
 * After a successful recipe generation the service calls the imageService to
 * produce a hero image from `recipe.imagePrompt`.  Image failure is non-fatal:
 * a null URL is returned and the UI falls back to a static placeholder.
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateObject } from "ai";
import { z } from "zod";
import matter from "gray-matter";
import pino from "pino";
import { getModel } from "./providerService.js";
import { generateImage } from "./imageService.js";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "recipeService" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../../../prompts/recipe");

// ---------------------------------------------------------------------------
// Domain type
// ---------------------------------------------------------------------------

export type RecipeDomain = "recipe" | "patisserie" | "spirits";

// ---------------------------------------------------------------------------
// Shared Zod output schema
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

/**
 * Shared recipe output schema.  Domain-specific fields (temperature,
 * glassware, garnish, alcoholic) are optional at the schema level and
 * populated by the domain-specific prompt.
 */
export const RecipeOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  yield: z.string(),
  prepTime: z.string(),
  cookTime: z.string(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  /** Patisserie: oven temperature + mode */
  temperature: z.string().optional(),
  /** Spirits: glassware type */
  glassware: z.string().optional(),
  /** Spirits: garnish specification */
  garnish: z.string().optional(),
  /** Spirits: true for alcoholic, false for mocktail/non-alcoholic */
  alcoholic: z.boolean().optional(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(StepSchema),
  proTips: z.array(z.string()).optional(),
  allergenNote: z.string(),
  /** Used to generate the hero image */
  imagePrompt: z.string(),
  confidenceNote: z.string(),
});

export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;

// ---------------------------------------------------------------------------
// Recipe input schemas (per-domain)
// ---------------------------------------------------------------------------

export interface RecipeInput {
  domain: RecipeDomain;
  /** Free-text description, name hint, or what they want to make */
  request: string;
  /** Optional constraints */
  dietary?: string[];
  servings?: number;
  difficulty?: string;
  /** Recipe-specific */
  cuisine?: string;
  mainIngredients?: string[];
  /** Patisserie-specific */
  pastryType?: string;
  keyTechnique?: string;
  occasion?: string;
  /** Spirits-specific */
  spiritBase?: string;
  flavourProfile?: string;
  alcoholic?: boolean;
  /** Kitchen context string from userContextService (optional) */
  kitchenContext?: string;
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

const PROMPT_FILES: Record<RecipeDomain, string> = {
  recipe: "recipePrompt.md",
  patisserie: "patisseriePrompt.md",
  spirits: "spiritsPrompt.md",
};

/** Load and parse a domain-specific recipe prompt file. */
async function loadDomainPrompt(domain: RecipeDomain): Promise<string> {
  const filePath = join(PROMPTS_DIR, PROMPT_FILES[domain]);
  const raw = await readFile(filePath, "utf-8");
  const { content } = matter(raw);
  return content.trim();
}

// ---------------------------------------------------------------------------
// User request → prompt message
// ---------------------------------------------------------------------------

/** Build the user-facing message that drives recipe generation. */
function buildUserMessage(input: RecipeInput): string {
  const parts: string[] = [];

  if (input.kitchenContext) {
    parts.push(input.kitchenContext);
    parts.push("");
  }

  parts.push(`Create a ${input.domain === "spirits" ? "drink" : "recipe"}: ${input.request}`);

  if (input.servings) parts.push(`Servings: ${input.servings}`);
  if (input.difficulty) parts.push(`Difficulty: ${input.difficulty}`);
  if (input.dietary && input.dietary.length > 0) {
    parts.push(`Dietary restrictions to respect: ${input.dietary.join(", ")}`);
  }

  // Domain-specific constraints
  if (input.domain === "recipe") {
    if (input.cuisine) parts.push(`Cuisine style: ${input.cuisine}`);
    if (input.mainIngredients && input.mainIngredients.length > 0) {
      parts.push(`Key ingredients to feature: ${input.mainIngredients.join(", ")}`);
    }
  } else if (input.domain === "patisserie") {
    if (input.pastryType) parts.push(`Pastry type: ${input.pastryType}`);
    if (input.keyTechnique) parts.push(`Key technique to showcase: ${input.keyTechnique}`);
    if (input.occasion) parts.push(`Occasion: ${input.occasion}`);
  } else if (input.domain === "spirits") {
    if (input.spiritBase) parts.push(`Spirit base or style: ${input.spiritBase}`);
    if (input.flavourProfile) parts.push(`Flavour profile: ${input.flavourProfile}`);
    if (input.occasion) parts.push(`Occasion: ${input.occasion}`);
    if (input.alcoholic === false) parts.push("Make this non-alcoholic (mocktail).");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Prose fallback
// ---------------------------------------------------------------------------

function proseFallback(input: RecipeInput): string {
  return (
    `I wasn't able to generate a structured ${input.domain} recipe for "${input.request}" right now. ` +
    `Here are some suggestions to get you started:\n\n` +
    `- Try simplifying your request (e.g. "classic beef stew" instead of multiple constraints at once)\n` +
    `- Check that your request is specific enough for a single recipe\n` +
    `- Try again in a moment if the AI service is under load\n\n` +
    `If the issue persists, ask the CulinAIre Kitchen chat assistant — it can help you build a recipe through conversation.`
  );
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

/**
 * Generate a structured recipe for the given domain and input.
 *
 * @returns An object containing the structured recipe and an optional hero
 *          image URL (null when image generation is unavailable or fails).
 */
export async function generateRecipe(input: RecipeInput): Promise<{
  recipe: RecipeOutput | null;
  imageUrl: string | null;
  proseResponse: string | null;
}> {
  let systemPrompt: string;
  try {
    systemPrompt = await loadDomainPrompt(input.domain);
  } catch (err) {
    logger.error({ err, domain: input.domain }, "generateRecipe: failed to load domain prompt");
    return { recipe: null, imageUrl: null, proseResponse: proseFallback(input) };
  }

  const model = getModel();
  const userMessage = buildUserMessage(input);

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
      return { recipe: null, imageUrl: null, proseResponse: proseFallback(input) };
    }
  }

  // Generate hero image (non-fatal if unavailable)
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

  return { recipe, imageUrl, proseResponse: null };
}
