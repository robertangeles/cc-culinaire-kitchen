import { z } from "zod";
import { numeric } from "./lenient.js";

/** The catalogue's item types and categories, the web's own lists (labels and which categories fit which type). */
export { CATEGORIES, CATEGORY_LABELS, ITEM_TYPES, ITEM_TYPE_KEYS, getCategoriesForType, type ItemTypeKey } from "../constants/inventory.js";

/**
 * The store room reads. The server leaves `currentQty` (and every value) out for someone without `inventory:cost`
 * (blind counting): those fields stay `undefined` here, so a screen shows a dash, never a zero.
 */

/** A quantity the server may leave out: a number, null (no stock row), or absent (hidden from this person). */
const hiddenQty = numeric.nullable().optional().catch(undefined);
const list = <T extends z.ZodTypeAny>(row: T) => z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = row.safeParse(r); return p.success ? [p.data as z.infer<T>] : []; }));

/** One store-room stock row on the dashboard (`stockLevels`). */
export const DashboardLevelSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string(),
  ingredientCategory: z.string().catch(""),
  baseUnit: z.string().catch(""),
  currentQty: hiddenQty,
  parLevel: numeric.nullable().catch(null),
});

/** `stockSummary`: low and critical for everyone who may see stock; `stockValue` and `valueByCategory` only with `inventory:cost`. */
export const StockSummarySchema = z.object({
  lowCount: z.number().catch(0),
  criticalCount: z.number().catch(0),
  lowIngredientIds: z.array(z.string()).catch([]),
  criticalIngredientIds: z.array(z.string()).catch([]),
  stockValue: z.number().optional().catch(undefined),
  valueByCategory: z.array(z.object({ category: z.string(), value: z.number() })).optional().catch(undefined),
});
export type StockSummary = z.infer<typeof StockSummarySchema>;

/** `GET /api/inventory/locations/:locId/dashboard`. The open stock take is read as "categories submitted of total". */
export const LocationDashboardSchema = z.object({
  stockLevels: list(DashboardLevelSchema).catch([]),
  stockSummary: StockSummarySchema,
  activeSession: z
    .object({ categories: z.array(z.object({ categoryStatus: z.string().catch("") })).catch([]) })
    .transform((s) => ({ submitted: s.categories.filter((c) => c.categoryStatus === "SUBMITTED").length, total: s.categories.length }))
    .nullable()
    .catch(null),
  lastCompletedSession: z.object({ closedDttm: z.string().nullable().catch(null) }).nullable().catch(null),
});
export type LocationDashboard = z.infer<typeof LocationDashboardSchema>;

/** An item as `GET /api/inventory/locations/:locId/ingredients` sends it: every catalogue item with this location's settings and store-room stock. */
export const LocationItemSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string().min(1),
  ingredientCategory: z.string().catch(""),
  itemType: z.string().catch(""),
  baseUnit: z.string().catch(""),
  /** The location's par, else null. */
  parLevel: numeric.nullable().catch(null),
  /** False when the item is not active at this location (no row there, or switched off). */
  activeInd: z.boolean().catch(false),
  currentQty: hiddenQty,
  lastCountedDttm: z.string().nullable().catch(null),
  supplierName: z.string().nullable().catch(null),
});
export type LocationItem = z.infer<typeof LocationItemSchema>;
export const LocationItemListSchema = list(LocationItemSchema);

/** `GET /api/inventory/locations/:locId/storage-areas/assignments`: item id -> the areas it is kept in. */
export const AreaAssignmentsSchema = z.record(z.unknown()).transform((map) => Object.fromEntries(Object.entries(map).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].every((v) => typeof v === "string"))));

/** `GET /api/inventory/ingredients/:id/stock-levels` (managers): the store-room stock of one item at every location. */
export const StockAcrossLocationsSchema = list(z.object({
  storeLocationId: z.string(),
  locationName: z.string(),
  currentQty: hiddenQty,
  parLevel: numeric.nullable().catch(null),
}));
export type StockAtLocation = z.infer<typeof StockAcrossLocationsSchema>[number];
