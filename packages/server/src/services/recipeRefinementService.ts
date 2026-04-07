/**
 * @module services/recipeRefinementService
 *
 * AI-powered recipe refinement service. Takes a current recipe and a
 * chef's instruction, then returns a modified recipe with a change summary.
 *
 * Uses the same generateObject + Zod pattern as recipeService.ts.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./providerService.js";
import pino from "pino";

const logger = pino({ name: "recipeRefinement" });

const DEFAULT_REFINEMENT_PROMPT = `You are a professional recipe editor working for CulinAIre Kitchen.
Given the current recipe JSON and the chef's instruction, modify the recipe accordingly.

RULES:
- Keep everything NOT mentioned in the instruction unchanged.
- Return the COMPLETE modified recipe — do not omit fields.
- Preserve all existing fields even if they are not part of the instruction.
- Update nutritionPerServing, allergenNote, flavorBalance, and storageAndSafety if the changes affect them.
- The changeSummary MUST be a short bulleted list using bullet characters (•), NOT a paragraph. Maximum 5 bullets. Example:
  • Added cherry tomatoes and mushrooms as side components
  • New Step 8: sauté mushrooms and blister tomatoes
  • Updated allergen note for mushroom intolerance
  • Adjusted nutrition values (calories, fat, carbs)
- Do NOT rename the recipe unless the instruction explicitly asks for it.
- Maintain the same difficulty level unless the instruction changes complexity.

FOOD SAFETY — MANDATORY:
- Every refined recipe MUST be safe for human consumption. This is non-negotiable.
- Verify all cooking temperatures meet food safety standards (e.g., poultry ≥ 74°C/165°F internal).
- If an ingredient substitution introduces a common allergen, UPDATE the allergenNote immediately.
- If the instruction would result in an unsafe preparation (e.g., raw poultry, unsafe canning, toxic ingredient combinations), REFUSE the modification and explain why in the changeSummary.
- Always include proper storage temperatures and shelf life in storageAndSafety when ingredients change.
- Cross-contamination risks must be noted when switching between allergen categories.
- If unsure about the safety of a modification, err on the side of caution and flag it in the changeSummary.

SOURCE PRIVACY:
- Never reveal where your culinary knowledge comes from.
- Do not mention book titles, authors, or specific sources.
- Present all knowledge as CulinAIre's own expertise.`;

// ---------------------------------------------------------------------------
// Refinement output schema (core recipe fields + changeSummary)
// ---------------------------------------------------------------------------

const RefinedIngredientSchema = z.object({
  amount: z.string(),
  unit: z.string(),
  name: z.string(),
  note: z.string().optional(),
});

const RefinedStepSchema = z.object({
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

const RefinementOutputSchema = z.object({
  // The refined recipe data
  refinedData: z.object({
    name: z.string(),
    description: z.string(),
    yield: z.string(),
    prepTime: z.string(),
    cookTime: z.string(),
    difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional().default("intermediate"),
    ingredients: z.array(RefinedIngredientSchema),
    steps: z.array(RefinedStepSchema),
    proTips: z.array(z.string()).optional(),
    allergenNote: z.string().optional().nullable(),
    storageAndSafety: z.string().optional().nullable(),
    flavorBalance: z.object({
      sweet: FlavorScoreSchema,
      salty: FlavorScoreSchema,
      sour: FlavorScoreSchema,
      bitter: FlavorScoreSchema,
      umami: FlavorScoreSchema,
    }).optional(),
    nutritionPerServing: z.array(NutritionSchema).optional(),
    // Preserve pass-through fields
    imagePrompt: z.string().optional(),
    confidenceNote: z.string().optional(),
    temperature: z.string().optional(),
    glassware: z.string().optional(),
    garnish: z.string().optional(),
    alcoholic: z.boolean().optional(),
    whyThisWorks: z.string().optional(),
    theResult: z.string().optional(),
    hookLine: z.string().optional(),
    storyBehindTheDish: z.string().optional(),
    platingGuide: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    winePairing: z.any().optional().nullable(),
    bakerPercentages: z.array(z.object({
      ingredient: z.string(),
      weight: z.string(),
      percentage: z.string(),
    })).optional(),
    textureContrast: z.string().optional(),
    makeAheadComponents: z.array(z.string()).optional(),
    criticalTemperatures: z.string().optional(),
    venueType: z.string().optional(),
    buildTime: z.string().optional(),
    ice: z.string().optional(),
    abv: z.string().optional(),
    standardDrinks: z.string().optional(),
    batchSpec: z.any().optional().nullable(),
    variations: z.any().optional().nullable(),
    foodPairing: z.any().optional().nullable(),
  }),
  // Summary of what changed
  changeSummary: z.string().describe("Short bulleted list of changes using • characters. Maximum 5 bullets. One change per bullet. NOT a paragraph."),
});

// ---------------------------------------------------------------------------
// Refinement function
// ---------------------------------------------------------------------------

/**
 * Refine an existing recipe based on a chef's instruction.
 *
 * @param currentRecipeData - The full recipe data object (from recipe_data JSONB)
 * @param instruction - The chef's modification instruction (e.g. "make it dairy-free")
 * @param kitchenContext - Optional kitchen profile context string
 * @returns The refined recipe data and a summary of changes
 */
export async function refineRecipe(
  currentRecipeData: Record<string, unknown>,
  instruction: string,
  kitchenContext?: string,
): Promise<{ refinedData: Record<string, unknown>; changeSummary: string }> {
  const model = getModel();

  // Load prompt from database (admin-editable via Settings → Prompts)
  const { getPromptRaw } = await import("./promptService.js");
  const promptResult = await getPromptRaw("recipeRefinementPrompt");
  let systemPrompt = promptResult.content;

  // Fallback if not yet configured in the database
  if (!systemPrompt) {
    systemPrompt = DEFAULT_REFINEMENT_PROMPT;
  }

  // Search RAG knowledge base for relevant context
  let ragContext = "";
  try {
    const { searchKnowledge } = await import("./knowledgeService.js");
    const recipeName = (currentRecipeData as any).name ?? "";
    const searchQuery = `${instruction} ${recipeName}`;
    const results = await searchKnowledge(searchQuery, "3");
    if (results.length > 0) {
      ragContext = `## Culinary Reference Knowledge:\n${results.map((r: any) => r.text ?? r.content ?? "").join("\n\n")}\n\n`;
    }
  } catch {
    // Knowledge search failed — continue without RAG context
  }

  const parts: string[] = [];
  if (ragContext) {
    parts.push(ragContext);
  }
  if (kitchenContext) {
    parts.push(`## Chef's Kitchen Context:\n${kitchenContext}\n`);
  }
  parts.push(`## Current Recipe:\n\`\`\`json\n${JSON.stringify(currentRecipeData, null, 2)}\n\`\`\`\n`);
  parts.push(`## Chef's Instruction:\n${instruction}`);

  const userMessage = parts.join("\n");

  logger.info({ instruction: instruction.slice(0, 100) }, "Refining recipe with AI");

  const { object } = await generateObject({
    model,
    schema: RefinementOutputSchema,
    system: systemPrompt,
    prompt: userMessage,
    maxTokens: 16384,
  });

  logger.info({ changeSummary: object.changeSummary }, "Recipe refinement complete");

  return {
    refinedData: object.refinedData as unknown as Record<string, unknown>,
    changeSummary: object.changeSummary,
  };
}
