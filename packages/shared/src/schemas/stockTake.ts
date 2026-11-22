import { z } from "zod";
import { numeric } from "./lenient.js";

/** An area (a stock-take category) and who holds it. Statuses stay strings: a status the phone does not know is simply not "done". */
export const AreaCategorySchema = z.object({
  categoryId: z.string(),
  categoryName: z.string(),
  categoryStatus: z.string(),
  claimedByUserId: z.number().nullable().catch(null),
  claimedByUserName: z.string().nullable().catch(null),
  claimRevision: z.number().catch(0),
});
export type AreaCategory = z.infer<typeof AreaCategorySchema>;

/** `GET /inventory/stock-takes/active`; the body is null when nothing is open. A count mode the phone does not know is shown as "count it on the web". */
export const ActiveSessionSchema = z
  .object({
    sessionId: z.string(),
    sessionStatus: z.string(),
    countMode: z.enum(["CATEGORY", "AREA"]).catch("CATEGORY"),
    locationName: z.string().catch(""),
    categories: z.array(AreaCategorySchema),
  })
  .nullish()
  .transform((s) => s ?? null);
export type ActiveSession = NonNullable<z.infer<typeof ActiveSessionSchema>>;

export const SheetItemSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string(),
  countUnit: z.string(),
  /** Other areas in this stock take that hold the same item. */
  alsoIn: z.array(z.string()).catch([]),
});
export type SheetItem = z.infer<typeof SheetItemSchema>;

export const AreaSheetSchema = z.object({ categoryId: z.string(), categoryName: z.string(), items: z.array(SheetItemSchema) });
export type AreaSheet = z.infer<typeof AreaSheetSchema>;
export const CountSheetsSchema = z.object({ areas: z.array(AreaSheetSchema) });

/** A line the server already holds for an area. `rawQty` is a numeric string on the wire. */
export const AreaLinesSchema = z.array(z.object({ ingredientId: z.string(), rawQty: numeric, countedUnit: z.string() }));
export type ServerLine = z.infer<typeof AreaLinesSchema>[number];

/** The shared items still to count, sent with a 409 when an area is submitted too early. */
export const MissingItemSchema = z.object({ ingredientId: z.string(), ingredientName: z.string(), areaNames: z.array(z.string()).catch([]) });
export type MissingItem = z.infer<typeof MissingItemSchema>;
export const SubmitConflictBodySchema = z.object({ missing: z.array(MissingItemSchema) });

/**
 * Codes the phone understands on the stock-take routes. A forward contract: the server does not send them yet, so
 * until it does the phone falls back to the old English text (`mobile/src/count/countApi.ts`, `mobile/src/outbox/outbox.ts`).
 */
export const STOCK_TAKE_CODES = {
  areaHeld: "STOCK_TAKE_AREA_HELD",
  areaSubmitted: "STOCK_TAKE_AREA_SUBMITTED",
  areaClosed: "STOCK_TAKE_AREA_CLOSED",
  claimedByOther: "STOCK_TAKE_CLAIMED_BY_OTHER",
  claimChanged: "STOCK_TAKE_CLAIM_CHANGED",
} as const;
