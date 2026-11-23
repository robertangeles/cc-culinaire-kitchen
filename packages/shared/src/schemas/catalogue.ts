import { z } from "zod";

/** The part of an ingredient the picker needs: `GET /api/inventory/ingredients` also sends costs and more, which the phone ignores. */
export const CatalogueIngredientSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string().min(1),
  /** The kitchen unit: the unit the item is counted and stocked in. */
  baseUnit: z.string().catch(""),
  ingredientCategory: z.string().catch(""),
  /** KITCHEN_INGREDIENT, FOH_CONSUMABLE, OPERATIONAL_SUPPLY...; "" from a server or a saved list that does not send it. */
  itemType: z.string().catch(""),
});
export type CatalogueIngredient = z.infer<typeof CatalogueIngredientSchema>;

/** A row that cannot be picked (no id or name) is skipped, never the whole catalogue. */
export const CatalogueSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = CatalogueIngredientSchema.safeParse(r); return p.success ? [p.data] : []; }));
