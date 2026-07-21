import { z } from "zod";

// Message roles
export const MessageRole = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRole>;

// Chat message
export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRole,
  content: z.string(),
  timestamp: z.string().datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

// Chat request
export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Chat response
export const ChatResponseSchema = z.object({
  response: z.string(),
  conversationId: z.string(),
  sources: z.array(z.string()),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Health check
export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

// ─── Purchasing: order guides (P1) ────────────────────────────────
// Shared so client/server drift fails at COMPILE time rather than at runtime —
// `any`-typed JSON is invisible to tsc, which is how the MFA field-name
// mismatch shipped. The server annotates getGuideItems with OrderGuideItemView.

/** A reusable per-supplier ordering list, as shown in a location's guide picker. */
export interface OrderGuideSummary {
  orderGuideId: string;
  name: string;
  supplierId: string;
  supplierName: string;
  /** null = an org-wide guide shared across locations. */
  storeLocationId: string | null;
  sortOrder: number;
  activeInd: boolean;
  /** ISO string over the wire (Date server-side). */
  updatedDttm: string;
  itemCount: number;
}

/**
 * One priced guide line, resolved against a location. Cost, pack size and the
 * supplier minimum are read live at render, never stored on the guide.
 */
export interface OrderGuideItemView {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  purchaseUnit: string | null;
  packQty: number | null;
  onHand: number;
  parLevel: number | null;
  /** P2 forecast PREVIEW — accepted into parLevel by the operator; never drives ordering. */
  suggestedParLevel: number | null;
  /** Shortfall in the KITCHEN unit (kg, bottle). Display only — never fill an order field from this. */
  suggestedOrderQty: number;
  /** Same shortfall in the PURCHASE unit (bag, case), rounded up. Null = no packaging, order in the kitchen unit. */
  suggestedPackages: number | null;
  belowPar: boolean;
  /** Cost per PURCHASE unit ($/bag). Null = no packaging; use unitCost. */
  packUnitCost: number | null;
  unitCost: number | null;
  supplierMinOrderQty: number | null;
  defaultOrderQty: number | null;
  defaultPurchaseUnit: string | null;
  sortOrder: number;
}
