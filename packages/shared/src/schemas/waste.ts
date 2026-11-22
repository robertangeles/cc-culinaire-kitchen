import { z } from "zod";
import { numeric } from "./lenient.js";

/** The waste logger's pick lists (the web's WasteLogger holds the same lists; the server accepts any text). */
export const WASTE_UNITS = ["kg", "g", "L", "ml", "each", "portion", "bunch"] as const;
export const WASTE_REASONS = ["Overproduction", "Spoilage", "Trim/Peel", "Plate Waste", "Contamination", "Expired", "Other"] as const;
export const WASTE_SHIFTS = ["Breakfast", "Lunch", "Dinner", "Prep", "Other"] as const;

/** A waste entry as the server returns it (`POST`, `PATCH` and the rows of `GET /api/waste`). The list leaves `storeLocationId` out. */
export const WasteEntrySchema = z.object({
  wasteLogId: z.string(),
  userId: z.number().catch(0),
  storeLocationId: z.string().nullable().catch(null),
  ingredientName: z.string(),
  quantity: numeric,
  unit: z.string().catch(""),
  estimatedCost: numeric.nullable().catch(null),
  reason: z.string().nullable().catch(null),
  notes: z.string().nullable().catch(null),
  shift: z.string().nullable().catch(null),
  loggedAt: z.string(),
  loggedBy: z.string().nullable().catch(null),
});
export type WasteEntry = z.infer<typeof WasteEntrySchema>;

/** `GET /api/waste`: `{ data, total }`. A row this version cannot read is skipped, never the whole list. */
export const WasteListSchema = z.object({
  data: z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = WasteEntrySchema.safeParse(r); return p.success ? [p.data] : []; })),
  total: z.number().catch(0),
});

/** `GET /api/waste/suggestions?q=`: `{ ingredients: string[] }`, reduced to the names. */
export const WasteSuggestionsSchema = z.object({ ingredients: z.array(z.string()).catch([]) }).transform((r) => r.ingredients);
