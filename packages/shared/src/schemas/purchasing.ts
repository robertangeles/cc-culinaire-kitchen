import { z } from "zod";
import { numeric } from "./lenient.js";

/** A figure the server may leave out (a price, a total, a stock quantity, hidden from some people): absent or unreadable is null, never 0. */
const figure = numeric.nullable().catch(null);
const text = z.string().nullable().catch(null);
/** Rows this version cannot read are skipped, never the whole list. */
const rowsOf = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(z.unknown()).transform((rows) => rows.flatMap((r): z.output<T>[] => { const p = schema.safeParse(r); return p.success ? [p.data] : []; }));

/** The order statuses the server writes today. Parsed as plain text: one this version does not know is shown as it is. */
export const ORDER_STATUSES = ["DRAFT", "PENDING_APPROVAL", "SENT", "RECEIVING", "RECEIVED", "PARTIAL_RECEIVED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** A purchase order as `GET /api/inventory/purchase-orders` lists it. The detail sends the same fields except where noted. */
export const OrderSummarySchema = z.object({
  poId: z.string(),
  poNumber: z.string(),
  status: z.string(),
  storeLocationId: z.string(),
  locationName: text,
  supplierId: z.string(),
  supplierName: text,
  /** "email", "phone"...; list only. */
  supplierOrderingMethod: text,
  supplierPhone: text,
  createdByUserId: z.number().catch(0),
  createdByUserName: text,
  createdDttm: text,
  /** List only. */
  submittedAt: text,
  sentAt: text,
  supplierEmailedAt: text,
  expectedDeliveryDate: text,
  notes: text,
  rejectedReason: text,
  /** Set when the order was sent; left out for someone who may not see costs. */
  totalValue: figure,
  /** List only. */
  lineCount: z.number().catch(0),
  beingReceivedBy: z.object({ userId: z.number(), userName: z.string() }).nullable().catch(null),
  /** Sent to approvers on an order waiting for approval: false on their own while someone else can approve it. */
  canApprove: z.boolean().optional().catch(undefined),
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;
export const OrderListSchema = rowsOf(OrderSummarySchema);

export const OrderLineSchema = z.object({
  lineId: z.string(),
  ingredientId: z.string(),
  ingredientName: text,
  orderedQty: numeric,
  orderedUnit: z.string().catch(""),
  receivedQty: figure,
  /** Per ordered unit; left out for someone who may not see costs. */
  unitCost: figure,
  /** What was paid at the door. */
  actualUnitCost: figure,
  lineStatus: z.string().catch(""),
  receivedByUserName: text,
  receivedDttm: text,
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

/** `GET /api/inventory/purchase-orders/:id`. */
export const OrderDetailSchema = OrderSummarySchema.extend({ lines: rowsOf(OrderLineSchema) });
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

/** The stored order a write answers with (create, clone): the screens need its id and number. `skippedItems` is clone only. */
export const OrderWriteReplySchema = z.object({ poId: z.string(), poNumber: z.string().catch(""), skippedItems: z.array(z.string()).catch([]) });
/** Submit: where the order went. Anything but HQ_APPROVAL went straight to SENT. */
export const OrderSubmitReplySchema = z.object({ poId: z.string(), status: z.string().catch("") });
export const OrderEmailReplySchema = z.object({ emailed: z.boolean(), to: text, message: text });

export const SupplierSchema = z.object({ supplierId: z.string(), supplierName: z.string().min(1) });
export type SupplierOption = z.infer<typeof SupplierSchema>;
export const SupplierListSchema = rowsOf(SupplierSchema);

/** An active item at a location (`GET /api/inventory/locations/:locId/ingredients`), what an order line needs of it. */
export const OrderItemSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string().min(1),
  /** Kitchen unit. Stored costs and stock are per kitchen unit. */
  baseUnit: z.string().catch(""),
  /** Package it is bought in (bag, case), and kitchen units per package. */
  purchaseUnit: text,
  packQty: figure,
  currentQty: figure,
  parLevel: figure,
  orgParLevel: figure,
  locationUnitCost: figure,
  orgUnitCost: figure,
  supplierMinOrderQty: figure,
});
export type OrderItem = z.infer<typeof OrderItemSchema>;
export const OrderItemListSchema = rowsOf(OrderItemSchema);

export const IngredientIdListSchema = rowsOf(z.string());

/** A supplier's regular list (`GET /api/inventory/locations/:locId/order-guides`). */
export const OrderGuideSchema = z.object({ orderGuideId: z.string(), name: z.string().min(1), supplierId: z.string(), supplierName: text, itemCount: z.number().catch(0) });
export type OrderGuide = z.infer<typeof OrderGuideSchema>;
export const OrderGuideListSchema = rowsOf(OrderGuideSchema);

/** One line of a guide, resolved by the server for a location (`GET /api/inventory/order-guides/:id/items`). */
export const OrderGuideItemSchema = z.object({
  ingredientId: z.string(),
  ingredientName: z.string().min(1),
  baseUnit: z.string().catch(""),
  purchaseUnit: text,
  packQty: figure,
  onHand: figure,
  parLevel: figure,
  /** Shortfall in the kitchen unit. */
  suggestedOrderQty: figure,
  /** The same in whole packages; null when it is ordered in the kitchen unit. */
  suggestedPackages: figure,
  unitCost: figure,
  /** Per package; null when it has no packaging. */
  packUnitCost: figure,
  supplierMinOrderQty: figure,
});
export type OrderGuideItem = z.infer<typeof OrderGuideItemSchema>;
export const OrderGuideItemListSchema = rowsOf(OrderGuideItemSchema);

/** A discrepancy of a confirmed delivery with no credit note yet (`GET /api/inventory/credit-notes/unresolved-discrepancies`). */
export const DiscrepancySchema = z.object({
  discrepancyId: z.string(),
  /** SHORT, REJECTED, PRICE_VARIANCE, SUBSTITUTION. */
  type: z.string(),
  poId: z.string(),
  poNumber: z.string().catch(""),
  locationName: text,
  supplierId: z.string(),
  supplierName: text,
  ingredientName: text,
  orderedQty: figure,
  orderedUnit: z.string().catch(""),
  receivedQty: figure,
  shortageQty: figure,
  poUnitCost: figure,
  actualUnitCost: figure,
  rejectionReason: text,
  rejectionNote: text,
  createdAt: text,
  /** The most it can be credited; null when the line has no price, so it cannot be credited. */
  maxCreditAmount: figure,
});
export type Discrepancy = z.infer<typeof DiscrepancySchema>;
export const DiscrepancyListSchema = rowsOf(DiscrepancySchema);

export const CreditNoteSchema = z.object({
  creditNoteId: z.string(),
  discrepancyId: z.string(),
  supplierId: z.string(),
  creditAmount: numeric,
  creditReference: text,
  notes: text,
  createdAt: text,
});
export type CreditNote = z.infer<typeof CreditNoteSchema>;
export const CreditNoteListSchema = rowsOf(CreditNoteSchema);
