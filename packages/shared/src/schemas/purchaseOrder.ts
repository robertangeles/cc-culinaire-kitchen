import { z } from "zod";
import { numeric } from "./lenient.js";

/** Decimal numbers travel as strings; blank and endless ones are refused here, not by the database. */
const isNumber = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));

const PurchaseOrderLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  orderedQty: z.string().refine((v) => isNumber(v) && Number(v) > 0, "Must be a positive number"),
  orderedUnit: z.string().min(1).max(20),
  unitCost: z.string().refine((v) => isNumber(v) && Number(v) >= 0, "Must be a non-negative number").optional(),
});

/** The body of `PUT /api/inventory/purchase-orders/:id`: the whole order, header and lines. It replaces a DRAFT's. */
export const PurchaseOrderInputSchema = z.object({
  storeLocationId: z.string().uuid(),
  supplierId: z.string().uuid(),
  lines: z.array(PurchaseOrderLineInputSchema).min(1, "At least one line item is required"),
  notes: z.string().max(2000).optional(),
  // "" is no date, as the server has always read it.
  expectedDeliveryDate: z.string().refine((v) => v === "" || !isNaN(Date.parse(v)), "Must be a date").optional(),
});
export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInputSchema>;

/** The body of `POST /api/inventory/purchase-orders`. */
export const CreatePurchaseOrderSchema = PurchaseOrderInputSchema.extend({
  // Client-made id: the same body again answers the first order (200), another body is 409 CONFLICT.
  poId: z.string().uuid("poId must be a UUID").optional(),
});
export type CreatePurchaseOrder = z.infer<typeof CreatePurchaseOrderSchema>;

/** An order as the two routes above answer it: the header and its lines (ids, no names). */
export const PurchaseOrderSchema = z.object({
  poId: z.string(),
  poNumber: z.string().catch(""),
  status: z.string().catch(""),
  storeLocationId: z.string(),
  supplierId: z.string(),
  notes: z.string().nullable().catch(null),
  rejectedReason: z.string().nullable().catch(null),
  expectedDeliveryDate: z.string().nullable().catch(null),
  lines: z.array(
    z.object({
      lineId: z.string(),
      ingredientId: z.string(),
      orderedQty: numeric,
      orderedUnit: z.string().catch(""),
      unitCost: numeric.nullable().catch(null),
    }),
  ),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
