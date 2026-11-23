import { z } from "zod";

// ─── FOH stock zone ───────────────────────────────────────────────────────────
export type StockZoneKey = "BOH" | "FOH";

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

// Chat request: POST /api/chat. The server keeps no conversation state, so the client sends the whole history every turn.
export const ChatRequestSchema = z.object({
  messages: z.array(z.object({ role: MessageRole, content: z.string() })),
  /** Honoured only while the admin setting for web search is on. */
  webSearch: z.boolean().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/**
 * What a client holds once it has read the whole of the POST /api/chat answer. The wire format is not JSON and
 * not SSE: a chunked text/plain body in the Vercel AI SDK v4 data-stream format, one `<code>:<json>\n` line per
 * part (`0` text delta, `3` error, `8` annotations, the rest tool calls and finish), so a client assembles this
 * from the lines. Errors before the stream starts are JSON `{ error, code? }` (see ApiErrorBody).
 */
export const ChatResponseSchema = z.object({
  text: z.string(),
  /** From the `brain_grounded` annotation, when saved notes informed the answer. Ids and labels only. */
  brainGrounded: z.array(z.object({ memoryId: z.string(), title: z.string().nullable(), sourceType: z.string() })).optional(),
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

export * from "./apiError.js";
export * from "./mobileConfig.js";
