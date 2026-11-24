import {
  CreditNoteListSchema,
  CreditNoteSchema,
  DiscrepancyListSchema,
  IngredientIdListSchema,
  OrderDetailSchema,
  OrderEmailReplySchema,
  OrderGuideItemListSchema,
  OrderGuideListSchema,
  OrderItemListSchema,
  OrderListSchema,
  OrderSubmitReplySchema,
  OrderWriteReplySchema,
  SupplierListSchema,
  type CreditNote,
  type Discrepancy,
  type OrderDetail,
  type OrderGuide,
  type OrderGuideItem,
  type OrderItem,
  type OrderSummary,
  type SupplierOption,
} from "@culinaire/shared/schemas/purchasing";
import type { ApiClient } from "../api/client";

const INV = "/api/inventory";
/** The server's most rows a page. */
export const PAGE = 50;

export interface OrderBody {
  storeLocationId: string;
  supplierId: string;
  lines: Array<{ ingredientId: string; orderedQty: string; orderedUnit: string; unitCost?: string }>;
  notes?: string;
  /** A calendar day, YYYY-MM-DD. */
  expectedDeliveryDate?: string;
}

export interface CreditBody {
  /** Made on the phone, so a repeat after a lost reply answers the note it made the first time. */
  creditNoteId: string;
  discrepancyId: string;
  creditAmount: number;
  creditReference?: string;
  notes?: string;
}

/** The calls the orders screens make. Writes are online-only: every one reaches the screen as an answer or an ApiError. */
export function createOrdersApi(client: ApiClient) {
  const post = (path: string, body?: unknown) => client.request("POST", `${INV}${path}`, body === undefined ? {} : { body });
  return {
    /** This location's orders, newest first; `statuses` is filtered by the server, so an old one is never lost off a page. */
    list(locationId: string, statuses: readonly string[], offset = 0): Promise<OrderSummary[]> {
      const q = new URLSearchParams({ storeLocationId: locationId, limit: String(PAGE), offset: String(offset) });
      if (statuses.length > 0) q.set("status", statuses.join(","));
      return client.request("GET", `${INV}/purchase-orders?${q}`, { schema: OrderListSchema });
    },
    detail(poId: string): Promise<OrderDetail> {
      return client.request("GET", `${INV}/purchase-orders/${poId}`, { schema: OrderDetailSchema });
    },
    create(body: OrderBody) {
      return client.request("POST", `${INV}/purchase-orders`, { body, schema: OrderWriteReplySchema });
    },
    submit(poId: string) {
      return client.request("POST", `${INV}/purchase-orders/${poId}/submit`, { schema: OrderSubmitReplySchema });
    },
    async cancel(poId: string): Promise<void> {
      await post(`/purchase-orders/${poId}/cancel`);
    },
    async approve(poId: string): Promise<void> {
      await post(`/purchase-orders/${poId}/approve`);
    },
    async reject(poId: string, reason: string): Promise<void> {
      await post(`/purchase-orders/${poId}/reject`, { reason });
    },
    /** The server renders a PDF and waits for the mail provider. */
    email(poId: string) {
      return client.request("POST", `${INV}/purchase-orders/${poId}/send-email`, { schema: OrderEmailReplySchema, timeoutMs: 60_000 });
    },
    /** A new draft from a finished order, at today's quantities below par. */
    clone(poId: string, storeLocationId: string) {
      return client.request("POST", `${INV}/purchase-orders/${poId}/clone`, { body: { storeLocationId }, schema: OrderWriteReplySchema });
    },

    suppliers(): Promise<SupplierOption[]> {
      return client.request("GET", `${INV}/suppliers`, { schema: SupplierListSchema });
    },
    supplierItemIds(supplierId: string): Promise<string[]> {
      return client.request("GET", `${INV}/suppliers/${supplierId}/ingredient-ids`, { schema: IngredientIdListSchema });
    },
    items(locationId: string): Promise<OrderItem[]> {
      return client.request("GET", `${INV}/locations/${locationId}/ingredients`, { schema: OrderItemListSchema });
    },
    guides(locationId: string): Promise<OrderGuide[]> {
      return client.request("GET", `${INV}/locations/${locationId}/order-guides`, { schema: OrderGuideListSchema });
    },
    guideItems(guideId: string, locationId: string): Promise<OrderGuideItem[]> {
      return client.request("GET", `${INV}/order-guides/${guideId}/items?locationId=${locationId}`, { schema: OrderGuideItemListSchema });
    },

    /** Organisation-wide, newest first. */
    discrepancies(offset = 0, supplierId?: string): Promise<Discrepancy[]> {
      const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (supplierId) q.set("supplierId", supplierId);
      return client.request("GET", `${INV}/credit-notes/unresolved-discrepancies?${q}`, { schema: DiscrepancyListSchema });
    },
    creditNotes(): Promise<CreditNote[]> {
      return client.request("GET", `${INV}/credit-notes`, { schema: CreditNoteListSchema });
    },
    credit(body: CreditBody): Promise<CreditNote> {
      return client.request("POST", `${INV}/credit-notes`, { body, schema: CreditNoteSchema });
    },
  };
}

export type OrdersApi = ReturnType<typeof createOrdersApi>;
