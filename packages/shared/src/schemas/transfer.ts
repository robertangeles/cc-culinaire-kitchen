import { z } from "zod";
import { numeric } from "./lenient.js";

/**
 * A transfer between two locations as `GET /api/inventory/transfers` and `/transfers/pending` send it.
 * Statuses: INITIATED -> SENT -> RECEIVED | DISCREPANCY, or INITIATED -> CANCELLED; an unknown one is kept as sent.
 */
export const TransferSummarySchema = z.object({
  transferId: z.string(),
  fromLocationId: z.string(),
  toLocationId: z.string(),
  status: z.string(),
  notes: z.string().nullable().catch(null),
  sentDttm: z.string().nullable().catch(null),
  receivedDttm: z.string().nullable().catch(null),
  createdDttm: z.string(),
  fromLocationName: z.string().nullable().catch(null),
  toLocationName: z.string().nullable().catch(null),
  initiatorName: z.string().nullable().catch(null),
  lineCount: numeric.catch(0),
});
export type TransferSummary = z.infer<typeof TransferSummarySchema>;
export const TransferListSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = TransferSummarySchema.safeParse(r); return p.success ? [p.data] : []; }));

/** One item on a transfer; `receivedQty` is null until it is received. Quantities are in `sentUnit`. */
export const TransferLineSchema = z.object({
  lineId: z.string(),
  ingredientId: z.string(),
  sentQty: numeric,
  sentUnit: z.string().catch(""),
  receivedQty: numeric.nullable().catch(null),
  lineStatus: z.string().catch("PENDING"),
  /** Empty when the item left the catalogue. */
  ingredientName: z.string().catch(""),
  baseUnit: z.string().catch(""),
});
export type TransferLine = z.infer<typeof TransferLineSchema>;

/** `GET /api/inventory/transfers/:id`: who sent and received it, and its lines. */
export const TransferDetailSchema = TransferSummarySchema.omit({ initiatorName: true, lineCount: true }).extend({
  initiatedByUserId: z.number().nullable().catch(null),
  sentByUserId: z.number().nullable().catch(null),
  receivedByUserId: z.number().nullable().catch(null),
  lines: z.array(TransferLineSchema),
});
export type TransferDetail = z.infer<typeof TransferDetailSchema>;
