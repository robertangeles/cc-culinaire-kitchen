import { GenerateReplySchema, RecipePageSchema, RecipeSchema, RefineReplySchema, type GenerateReply, type Recipe, type RecipeDomain, type RecipePage, type RefineReply } from "@culinaire/shared/schemas/recipe";
import type { ApiClient } from "../api/client";

/** What the Recipe Lab form sends (`POST /api/recipes/generate`); the server checks the same limits. */
export interface RecipeRequest {
  request: string;
  servings: number;
  difficulty?: "beginner" | "intermediate" | "advanced" | "expert";
  dietary?: string[];
  cuisine?: string;
  mainIngredients?: string[];
  occasion?: string;
}

export const PAGE_SIZE = 20;
// The server stops a generation after 150 s and a refinement after 90 s and answers AI_TIMEOUT; wait a little longer than that.
const GENERATE_MS = 170_000;
const REFINE_MS = 110_000;

export function createRecipeApi(client: ApiClient) {
  const one = (id: string) => `/api/recipes/${encodeURIComponent(id)}`;
  return {
    /** My recipes, newest first; archived ones are left out by the server. */
    mine(page: number, domain?: RecipeDomain, limit = PAGE_SIZE): Promise<RecipePage> {
      return client.request("GET", `/api/recipes/my?page=${page}&limit=${limit}${domain ? `&domain=${domain}` : ""}`, { schema: RecipePageSchema });
    },
    get(id: string): Promise<Recipe> {
      return client.request("GET", one(id), { schema: RecipeSchema });
    },
    /** Saves the recipe when it is made. Stopping it (`signal`) makes the server stop and save nothing. */
    generate(body: RecipeRequest, signal: AbortSignal): Promise<GenerateReply> {
      return client.request("POST", "/api/recipes/generate", { body, signal, timeoutMs: GENERATE_MS, schema: GenerateReplySchema });
    },
    /** A proposal only: nothing is saved until it is accepted. */
    refine(id: string, instruction: string, signal: AbortSignal): Promise<RefineReply> {
      return client.request("POST", `${one(id)}/refine`, { body: { instruction }, signal, timeoutMs: REFINE_MS, schema: RefineReplySchema });
    },
    async accept(id: string, recipeData: unknown, changeSummary: string): Promise<void> {
      await client.request("POST", `${one(id)}/accept-refinement`, { body: { recipeData, changeSummary } });
    },
    async setPublic(id: string, isPublic: boolean): Promise<void> {
      await client.request("PATCH", one(id), { body: { isPublicInd: isPublic } });
    },
  };
}

export type RecipeApi = ReturnType<typeof createRecipeApi>;
