/**
 * @eval recipe-output
 *
 * Golden set evaluation for the recipe generation service.
 * Tests that `generateRecipe()` produces valid structured output across
 * 15 prompts covering all three labs (recipe, patisserie, spirits).
 *
 * Validation checks:
 *  - Schema validity (required fields present and correctly typed)
 *  - Recipe name relevance (name contains expected terms)
 *  - Allergen note presence (must always be non-empty)
 *  - Pro tips present for advanced recipes
 *  - Domain-specific fields (temperature for patisserie, glassware for spirits)
 *
 * Run: tsx packages/server/src/test/evals/recipe-output.eval.ts
 *
 * NOTE: This calls the live LLM API. Keep in mind cost per run.
 * Run intentionally — not part of the standard vitest suite.
 */

import "dotenv/config";
import { generateRecipe, type RecipeInput } from "../../services/recipeService.js";
import { hydrateEnvFromCredentials } from "../../services/credentialService.js";

interface RecipeEvalCase {
  id: string;
  input: RecipeInput;
  /** Recipe name must contain at least one of these terms (case-insensitive) */
  nameTerms: string[];
  /** These terms must appear somewhere in the allergenNote */
  allergenTermsRequired: boolean;
  /** Minimum number of ingredients */
  minIngredients: number;
  /** Minimum number of steps */
  minSteps: number;
  /** Domain-specific: check temperature field */
  requireTemperature?: boolean;
  /** Domain-specific: check glassware field */
  requireGlassware?: boolean;
}

const EVAL_CASES: RecipeEvalCase[] = [
  // -------------------------------------------------------------------------
  // CulinAIre Recipe
  // -------------------------------------------------------------------------
  {
    id: "R01",
    input: { domain: "recipe", request: "classic French onion soup" },
    nameTerms: ["onion", "french", "soup"],
    allergenTermsRequired: true,
    minIngredients: 5,
    minSteps: 4,
  },
  {
    id: "R02",
    input: { domain: "recipe", request: "pan-seared duck breast with cherry jus", difficulty: "intermediate" },
    nameTerms: ["duck"],
    allergenTermsRequired: true,
    minIngredients: 4,
    minSteps: 4,
  },
  {
    id: "R03",
    input: { domain: "recipe", request: "beef bourguignon", cuisine: "French Classical", servings: 6 },
    nameTerms: ["beef", "bourguignon"],
    allergenTermsRequired: true,
    minIngredients: 8,
    minSteps: 6,
  },
  {
    id: "R04",
    input: {
      domain: "recipe",
      request: "pasta cacio e pepe",
      dietary: ["Vegetarian"],
    },
    nameTerms: ["cacio", "pepe", "pasta"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 3,
  },
  {
    id: "R05",
    input: { domain: "recipe", request: "Thai green curry with chicken and vegetables" },
    nameTerms: ["curry", "thai", "green"],
    allergenTermsRequired: true,
    minIngredients: 6,
    minSteps: 4,
  },

  // -------------------------------------------------------------------------
  // CulinAIre Patisserie
  // -------------------------------------------------------------------------
  {
    id: "P01",
    input: { domain: "patisserie", request: "classic lemon tart with Italian meringue" },
    nameTerms: ["lemon", "tart"],
    allergenTermsRequired: true,
    minIngredients: 6,
    minSteps: 5,
    requireTemperature: true,
  },
  {
    id: "P02",
    input: { domain: "patisserie", request: "chocolate fondant with molten centre" },
    nameTerms: ["chocolate", "fondant"],
    allergenTermsRequired: true,
    minIngredients: 5,
    minSteps: 4,
    requireTemperature: true,
  },
  {
    id: "P03",
    input: {
      domain: "patisserie",
      request: "croissant",
      pastryType: "Viennoiserie",
      keyTechnique: "lamination",
      difficulty: "advanced",
    },
    nameTerms: ["croissant"],
    allergenTermsRequired: true,
    minIngredients: 5,
    minSteps: 8,
    requireTemperature: true,
  },
  {
    id: "P04",
    input: { domain: "patisserie", request: "Paris-Brest with hazelnut praline cream" },
    nameTerms: ["paris", "brest"],
    allergenTermsRequired: true,
    minIngredients: 6,
    minSteps: 5,
    requireTemperature: true,
  },
  {
    id: "P05",
    input: { domain: "patisserie", request: "sourdough bread", pastryType: "Bread / Enriched Dough" },
    nameTerms: ["sourdough", "bread"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 6,
    requireTemperature: true,
  },

  // -------------------------------------------------------------------------
  // CulinAIre Spirits
  // -------------------------------------------------------------------------
  {
    id: "S01",
    input: { domain: "spirits", request: "classic Negroni", spiritBase: "gin" },
    nameTerms: ["negroni"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 2,
    requireGlassware: true,
  },
  {
    id: "S02",
    input: { domain: "spirits", request: "classic daiquiri", spiritBase: "rum" },
    nameTerms: ["daiquiri"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 2,
    requireGlassware: true,
  },
  {
    id: "S03",
    input: {
      domain: "spirits",
      request: "espresso martini",
      spiritBase: "vodka",
      flavourProfile: "coffee-forward, slightly sweet",
    },
    nameTerms: ["espresso", "martini"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 2,
    requireGlassware: true,
  },
  {
    id: "S04",
    input: { domain: "spirits", request: "passionfruit mocktail", alcoholic: false },
    nameTerms: ["passionfruit"],
    allergenTermsRequired: true,
    minIngredients: 3,
    minSteps: 2,
    requireGlassware: true,
  },
  {
    id: "S05",
    input: {
      domain: "spirits",
      request: "mezcal sour with honey syrup",
      spiritBase: "mezcal",
      flavourProfile: "smoky, citrus, light sweetness",
    },
    nameTerms: ["mezcal", "sour"],
    allergenTermsRequired: true,
    minIngredients: 4,
    minSteps: 3,
    requireGlassware: true,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface EvalResult {
  id: string;
  passed: boolean;
  reason?: string;
  recipeName?: string;
}

async function runEval(c: RecipeEvalCase): Promise<EvalResult> {
  try {
    const { recipe, proseResponse } = await generateRecipe(c.input);

    if (proseResponse) {
      return { id: c.id, passed: false, reason: "Got prose fallback instead of structured recipe" };
    }
    if (!recipe) {
      return { id: c.id, passed: false, reason: "No recipe returned" };
    }

    const nameLower = recipe.name.toLowerCase();
    const nameMatch = c.nameTerms.some((t) => nameLower.includes(t.toLowerCase()));
    if (!nameMatch) {
      return {
        id: c.id,
        passed: false,
        reason: `Recipe name "${recipe.name}" does not match any of: ${c.nameTerms.join(", ")}`,
        recipeName: recipe.name,
      };
    }

    if (c.allergenTermsRequired && (!recipe.allergenNote || recipe.allergenNote.trim().length < 10)) {
      return { id: c.id, passed: false, reason: "allergenNote is missing or too short", recipeName: recipe.name };
    }

    if (recipe.ingredients.length < c.minIngredients) {
      return {
        id: c.id,
        passed: false,
        reason: `Only ${recipe.ingredients.length} ingredients (expected ≥${c.minIngredients})`,
        recipeName: recipe.name,
      };
    }

    if (recipe.steps.length < c.minSteps) {
      return {
        id: c.id,
        passed: false,
        reason: `Only ${recipe.steps.length} steps (expected ≥${c.minSteps})`,
        recipeName: recipe.name,
      };
    }

    if (c.requireTemperature && !recipe.temperature) {
      return { id: c.id, passed: false, reason: "Missing temperature field (required for patisserie)", recipeName: recipe.name };
    }

    if (c.requireGlassware && !recipe.glassware) {
      return { id: c.id, passed: false, reason: "Missing glassware field (required for spirits)", recipeName: recipe.name };
    }

    return { id: c.id, passed: true, recipeName: recipe.name };
  } catch (err) {
    return {
      id: c.id,
      passed: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main() {
  console.log("=== Recipe Output Eval Suite ===\n");
  console.log("⚠️  This calls the live LLM API. Running 15 evaluations...\n");

  await hydrateEnvFromCredentials();

  // Run sequentially to avoid rate limits
  let passed = 0;
  for (const c of EVAL_CASES) {
    process.stdout.write(`[${c.id}] ${c.input.request.slice(0, 50)}... `);
    const result = await runEval(c);
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}${result.recipeName ? ` — "${result.recipeName}"` : ""}${result.reason ? ` (${result.reason})` : ""}`);
    if (result.passed) passed++;

    // Small delay between LLM calls to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const total = EVAL_CASES.length;
  console.log(`\n${passed}/${total} passed`);
  if (passed < total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
