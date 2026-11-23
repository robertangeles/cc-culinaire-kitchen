import { z } from "zod";
import { numeric } from "./lenient.js";

/** The consumption logger's pick lists. The web's `ConsumptionLogger.tsx` holds the same keys and labels (the server accepts any reason text); keep the two in step. */
export const CONSUMPTION_REASONS = [
  { key: "kitchen_operations", label: "Kitchen" },
  { key: "foh_operations", label: "FOH" },
  { key: "staff_consumption", label: "Staff" },
  { key: "cleaning", label: "Cleaning" },
  { key: "admin", label: "Admin" },
  { key: "breakage", label: "Breakage" },
  { key: "other", label: "Other" },
  { key: "return_to_stock", label: "Return to Stockroom" },
] as const;
export const CONSUMPTION_SHIFTS = [
  { key: "morning", label: "AM" },
  { key: "afternoon", label: "PM" },
  { key: "evening", label: "Eve" },
  { key: "closing", label: "Close" },
] as const;

/** This reason puts stock back instead of taking it out (`consumptionLogService.ts`). */
export const RETURN_TO_STOCK = "return_to_stock";

/**
 * Item types where "FOH" means the stock moved to the bar or floor and is still sellable: logging it as usage deducts it now and again
 * when it sells. Operational supplies (napkins) really are used, so they are not here.
 */
export const FOH_MOVE_ITEM_TYPES: readonly string[] = ["KITCHEN_INGREDIENT", "FOH_CONSUMABLE"];

/** An entry as `GET /api/inventory/consumption-logs` sends it (the list leaves out the location and the dish). */
export const ConsumptionEntrySchema = z.object({
  consumptionLogId: z.string(),
  ingredientId: z.string(),
  ingredientName: z.string(),
  quantity: numeric,
  unit: z.string().catch(""),
  reason: z.string().catch(""),
  notes: z.string().nullable().catch(null),
  shift: z.string().nullable().catch(null),
  loggedAt: z.string(),
  userId: z.number().catch(0),
  userName: z.string().nullable().catch(null),
});
export type ConsumptionEntry = z.infer<typeof ConsumptionEntrySchema>;

/** A bare array; a row this version cannot read is skipped, never the whole list. */
export const ConsumptionListSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = ConsumptionEntrySchema.safeParse(r); return p.success ? [p.data] : []; }));
