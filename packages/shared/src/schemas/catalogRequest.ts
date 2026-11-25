import { z } from "zod";
import { numeric } from "./lenient.js";

/**
 * A catalogue request as `GET /api/inventory/catalog-requests/mine` returns it: an item someone asked HQ to add.
 * `status` stays a string (PENDING, APPROVED, REJECTED today): a status the phone does not know is shown as sent.
 * `reviewNotes` is HQ's reason when it rejects; `createdIngredientId` the item it made when it approves.
 */
export const CatalogRequestSchema = z.object({
  requestId: z.string(),
  storeLocationId: z.string(),
  itemName: z.string(),
  itemType: z.string().catch(""),
  category: z.string().nullable().catch(null),
  baseUnit: z.string().nullable().catch(null),
  countedQty: numeric.nullable().catch(null),
  status: z.string().catch("PENDING"),
  reviewNotes: z.string().nullable().catch(null),
  createdIngredientId: z.string().nullable().catch(null),
  createdDttm: z.string(),
  updatedDttm: z.string().catch(""),
});
export type CatalogRequest = z.infer<typeof CatalogRequestSchema>;

/** `{ data, total }`, newest first. A row this version cannot read is skipped, never the whole list. */
export const CatalogRequestListSchema = z.object({
  data: z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = CatalogRequestSchema.safeParse(r); return p.success ? [p.data] : []; })),
  total: z.number().catch(0),
});
