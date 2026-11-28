import { z } from "zod";
import { numeric } from "./lenient.js";

/**
 * Menu and costing as the phone reads it. A cost the server leaves out (a person without `inventory:cost`) stays
 * `undefined` here, so a screen shows nothing, never a zero.
 */

/** A cost the server may leave out: a number, null (none stored), or absent (hidden from this person). */
const cost = numeric.nullable().optional().catch(undefined);
const text = z.string().nullable().catch(null);
const list = <T extends z.ZodTypeAny>(row: T) => z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = row.safeParse(r); return p.success ? [p.data as z.infer<T>] : []; }));

/** The category names the web's item editor offers before any item exists. */
export const DEFAULT_MENU_CATEGORIES = ["Appetizers", "Soups & Salads", "Entrees", "Seafood", "Pasta", "Grilled", "Sides", "Desserts", "Beverages", "Cocktails", "Brunch"] as const;

export const MenuItemSchema = z.object({
  menuItemId: z.string(),
  /** The creator. */
  userId: z.number().optional().catch(undefined),
  name: z.string().min(1),
  category: z.string().catch(""),
  sellingPrice: numeric,
  /** How many servings the recipe makes. */
  servings: z.number().catch(1),
  /** How many servings one sale (the selling price) covers. */
  servingsPerSale: z.number().catch(1),
  qFactorPct: numeric.catch(0),
  /** What the server stored (`storedItemCosts`), per sale. */
  foodCost: cost,
  foodCostPct: cost,
  contributionMargin: cost,
  unitsSold: z.number().catch(0),
  /** Its share of all units sold, in percent, as the server worked it out. */
  menuMixPct: numeric.catch(0),
  /** star, plowhorse, puzzle, dog, unclassified, or a class this version does not know. */
  classification: z.string().catch("unclassified"),
  containsDairyInd: z.boolean().catch(false),
  containsGlutenInd: z.boolean().catch(false),
  containsNutsInd: z.boolean().catch(false),
  containsShellfishInd: z.boolean().catch(false),
  containsEggsInd: z.boolean().catch(false),
  isVegetarianInd: z.boolean().catch(false),
  /** The caller holds `menu:manage` and made the item or administers its organisation. Absent from an older server. */
  canManage: z.boolean().optional().catch(undefined),
});
export type MenuItem = z.infer<typeof MenuItemSchema>;

/** `GET /api/menu/analysis`: the organisation's items with their mix and class. The phone works the summary out from them with the server's own `summariseMenuAnalysis`. */
export const MenuAnalysisSchema = z.object({ items: list(MenuItemSchema) });

/** `POST /api/menu/items`: the new row; the list is read again for the rest. */
export const CreatedMenuItemSchema = z.object({ menuItemId: z.string() });

/** `GET /api/menu/items/:id/ingredients`: one recipe line, with what the unit resolver needs of the linked catalogue item. */
export const MenuLineSchema = z.object({
  id: z.number(),
  ingredientId: text,
  ingredientName: z.string().min(1),
  note: text,
  quantity: numeric,
  unit: z.string(),
  /** Per kitchen unit (`baseUnit`) when linked, per `unit` for a typed name. */
  unitCost: cost,
  yieldPct: numeric.catch(100),
  lineCost: cost,
  /** The catalogue cost changed since this line was priced. */
  costStaleInd: z.boolean().catch(false),
  baseUnit: text,
  contentQty: numeric.nullable().catch(null),
  contentUnit: text,
  densityGPerMl: numeric.nullable().catch(null),
  purchaseUnit: text,
  packQty: numeric.nullable().catch(null),
  catalogUnitCost: cost,
});
export type MenuLine = z.infer<typeof MenuLineSchema>;
export const MenuLineListSchema = list(MenuLineSchema);

/** `GET /api/menu/categories`: this person's food cost targets. */
export const CategoryTargetListSchema = list(z.object({ categoryName: z.string(), targetFoodCostPct: numeric }));

/** `GET /api/recipes/for-import`: the recipes a menu item can start from. */
export const ImportRecipeListSchema = z
  .object({
    recipes: list(
      z.object({
        recipeId: z.union([z.string(), z.number()]).transform(String),
        title: z.string().min(1),
        domain: z.string().catch("recipe"),
        yield: z.string().optional().catch(undefined),
        ingredients: list(z.object({ name: z.string().min(1), amount: z.union([z.string(), z.number()]).transform(String).catch(""), unit: z.string().catch("each"), note: text })).catch([]),
      }),
    ),
  })
  .transform((r) => r.recipes);
export type ImportRecipe = z.infer<typeof ImportRecipeListSchema>[number];

/** The catalogue as the recipe editor needs it: `GET /api/inventory/ingredients` with units, packaging and (with `inventory:cost`) costs. */
export const MenuCatalogueSchema = list(z.object({
  ingredientId: z.string(),
  ingredientName: z.string().min(1),
  baseUnit: z.string().catch(""),
  ingredientCategory: z.string().catch(""),
  contentQty: numeric.nullable().catch(null),
  contentUnit: text,
  densityGPerMl: numeric.nullable().catch(null),
  purchaseUnit: text,
  packQty: numeric.nullable().catch(null),
  preferredUnitCost: cost,
  unitCost: cost,
}));
export type MenuCatalogueItem = z.infer<typeof MenuCatalogueSchema>[number];

/** `GET /api/inventory/ingredients/:id/conversions`: the item's own units. */
export const ConversionListSchema = z
  .object({ conversions: list(z.object({ fromUnit: z.string(), toBaseFactor: numeric })).catch([]) })
  .transform((r) => r.conversions);

/** `GET /api/menu/consumables`: front-of-house items sold as they are. */
export const ConsumableListSchema = list(z.object({ ingredientId: z.string(), ingredientName: z.string().min(1), baseUnit: z.string().catch("") }));
export type SellableConsumable = z.infer<typeof ConsumableListSchema>[number];

/** `POST /api/menu/items/:id/sales`. A repeat of a key already recorded answers `alreadyExists`, with nothing depleted again. */
export const SaleResultSchema = z.object({
  saleId: z.string(),
  alreadyExists: z.boolean().catch(false),
  voided: z.boolean().catch(false),
  depleted: list(z.object({ ingredientId: z.string(), ingredientName: z.string().catch(""), baseQty: numeric, baseUnit: z.string().catch(""), fohOnHand: cost })).catch([]),
  skipped: list(z.object({ ingredientName: z.string() })).catch([]),
  oversold: z.array(z.string()).catch([]),
});
export type SaleResult = z.infer<typeof SaleResultSchema>;

/** `GET /api/menu/locations/:locId/sales`, newest first. */
export const SaleListSchema = list(z.object({
  saleId: z.string(),
  menuItemName: z.string().catch(""),
  qtySold: numeric,
  soldAt: z.string(),
  voidedAt: text,
  /** The caller may void it (its recorder or an organisation admin, with `menu:manage`). Absent from an older server. */
  canManage: z.boolean().optional().catch(undefined),
}));
export type Sale = z.infer<typeof SaleListSchema>[number];

/** `GET /api/menu/waste-impact`: the last 30 days of waste of each item's ingredients, for items that have any. The dollars go only to `inventory:cost` holders. */
export const WasteImpactListSchema = list(z.object({ menuItemId: z.string(), wasteEstimate: cost }));
export type WasteImpact = z.infer<typeof WasteImpactListSchema>[number];

/**
 * `GET /api/menu/items/:id/yield-variance`: the recipe's food cost over the sales period against what was logged as used for the dish.
 * `status` is ok, no-period, thin-data, no-recipe, uncosted, or one this version does not know; the figures only for `inventory:cost` holders.
 */
export const YieldVarianceSchema = z.object({
  status: z.string().catch(""),
  theoretical: cost,
  actual: cost,
  variance: cost,
  variancePct: cost,
  /** good, warning or alert; null when there is no variance to judge. */
  threshold: z.string().nullable().optional().catch(undefined),
  unitsSold: z.number().catch(0),
  consumptionLogCount: z.number().catch(0),
  periodStart: text,
  periodEnd: text,
});
export type YieldVariance = z.infer<typeof YieldVarianceSchema>;

/** `GET /api/menu/items/:id/pandl-cost`: one serving's food cost at the item's location's weighted average cost (`plateFoodCost`), only for `inventory:cost` holders. */
export const PlateCostSchema = z.object({ foodCost: cost });

/** `GET /api/menu/items/:id/recommendations`: the model's advice on one item. */
export const RecommendationSchema = z.object({
  summary: z.string().catch(""),
  /** `type` is one of the server's actions (protect, raise_price, generate_replacement…) or one this version does not know. */
  actions: list(z.object({ type: z.string().catch(""), description: z.string().min(1), impact: z.string().optional().catch(undefined) })).catch([]),
  menuDescription: z.string().optional().catch(undefined),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** `POST /api/menu/items/:id/generate-replacement`: the Recipe Lab request that asks for a replacement. */
export const ReplacementSchema = z.object({ request: z.string().min(1) });

/** `POST /api/menu/sales/import/preview`: the CSV's rows matched to menu items; nothing is recorded yet. */
export const SalesCsvPreviewSchema = z.object({
  matched: list(z.object({ rowIndex: z.number(), menuItemId: z.string(), name: z.string().min(1), qtySold: numeric, soldAt: z.string().optional().catch(undefined) })).catch([]),
  unmatched: list(z.object({ rowIndex: z.number(), name: z.string().catch(""), reason: z.string().catch("") })).catch([]),
});
export type SalesCsvPreview = z.infer<typeof SalesCsvPreviewSchema>;

/** `POST /api/menu/sales/import/commit`. A row already imported (the same item, quantity, time and location) answers under `alreadyExists`. */
export const SalesCsvReportSchema = z.object({
  succeeded: z.array(z.unknown()).catch([]),
  alreadyExists: z.array(z.unknown()).catch([]),
  failed: list(z.object({ rowIndex: z.number(), reason: z.string().catch("") })).catch([]),
});
export type SalesCsvReport = z.infer<typeof SalesCsvReportSchema>;

/** `POST /api/menu/import-sales`: units sold set from a CSV; `notFound` names the rows matched to no item (or to more than one). */
export const UnitsImportSchema = z.object({ updated: z.number().catch(0), notFound: z.array(z.string()).catch([]) });
export type UnitsImport = z.infer<typeof UnitsImportSchema>;
