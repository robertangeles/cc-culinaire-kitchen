import { z } from "zod";

const keep = <T extends z.ZodTypeAny>(item: T) =>
  z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((r) => { const p = item.safeParse(r); return p.success ? [p.data as z.infer<T>] : []; }));
const text = z.string().catch("");
const optionalText = z.string().optional().catch(undefined);

/**
 * The parts of a generated recipe (`recipeData`, the server's `RecipeOutputSchema`) the phone shows. The model writes it, so
 * everything is lenient; the extras the web shows (flavour balance, nutrition, wine pairing, pastry and bar specs) are not read.
 */
export const RecipeDataSchema = z.object({
  name: text,
  description: text,
  yield: text,
  prepTime: text,
  cookTime: text,
  difficulty: text,
  ingredients: keep(z.object({ amount: z.union([z.string(), z.number()]).transform(String).catch(""), unit: text, name: z.string(), note: optionalText })),
  steps: keep(z.object({ step: z.number().catch(0), instruction: z.string() })),
  proTips: z.array(z.string()).catch([]),
  whyThisWorks: optionalText,
  allergenNote: text,
  confidenceNote: text,
  glassware: optionalText,
  garnish: optionalText,
});
export type RecipeData = z.infer<typeof RecipeDataSchema>;
export const parseRecipeData = (raw: unknown): RecipeData => RecipeDataSchema.parse(typeof raw === "object" && raw !== null ? raw : {});

export const RECIPE_DOMAINS = ["recipe", "patisserie", "spirits"] as const;
export type RecipeDomain = (typeof RECIPE_DOMAINS)[number];

/** A row of `GET /api/recipes/my` (newest first, archived left out). */
export const RecipeSummarySchema = z.object({
  recipeId: z.string(),
  slug: z.string().nullable().catch(null),
  title: z.string().catch("Recipe"),
  description: z.string().nullable().catch(null),
  domain: z.string().catch("recipe"),
  imageUrl: z.string().nullable().catch(null),
  isPublicInd: z.boolean().catch(false),
  createdDttm: z.string().catch(""),
});
export type RecipeSummary = z.infer<typeof RecipeSummarySchema>;
export const RecipePageSchema = z.object({
  recipes: keep(RecipeSummarySchema),
  total: z.number().catch(0),
  page: z.number().catch(1),
});
export type RecipePage = z.infer<typeof RecipePageSchema>;

/**
 * `GET /api/recipes/:id`. `userId` is sent only to the recipe's owner. `recipeData` is kept as the server sent it, because a
 * refinement is accepted by sending it back whole; read it with `parseRecipeData`.
 */
export const RecipeSchema = z.object({
  recipeId: z.string(),
  slug: z.string().nullable().catch(null),
  userId: z.number().nullable().optional().catch(undefined),
  domain: z.string().catch("recipe"),
  title: z.string().catch("Recipe"),
  description: z.string().nullable().catch(null),
  recipeData: z.unknown(),
  imageUrl: z.string().nullable().catch(null),
  isPublicInd: z.boolean().catch(false),
  createdDttm: z.string().catch(""),
});
export type Recipe = z.infer<typeof RecipeSchema>;

const MemorySchema = z.object({ title: z.string().nullable().catch(null) });

/**
 * `POST /api/recipes/generate`: a saved recipe with the kitchen notes it drew on (`brainGrounded`, the phone's "Grounded in your
 * Brain" marker), or `prose` when the model answered in words instead (nothing saved, nothing charged).
 */
export const GenerateReplySchema = z.union([
  z.object({
    recipe: z.unknown(),
    recipeId: z.string().nullable().catch(null),
    brainGrounded: keep(MemorySchema).optional(),
  }).refine((r) => r.recipe !== undefined),
  z.object({ prose: z.string() }),
]);
export type GenerateReply = z.infer<typeof GenerateReplySchema>;

/** `POST /api/recipes/:id/refine`: the proposed recipe (saved only when accepted) and what changed. */
export const RefineReplySchema = z.object({ refinedData: z.unknown().refine((v) => typeof v === "object" && v !== null), changeSummary: z.string().catch("") });
export type RefineReply = z.infer<typeof RefineReplySchema>;
