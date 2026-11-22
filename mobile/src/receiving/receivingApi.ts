import type { ApiClient } from "../api/client";
import type { ConfirmResult, LineInput, QueueItem, ReceivingLine } from "./receivingFlow";

export interface ReceivingSession {
  sessionId: string;
  poId: string;
  storeLocationId: string;
  receivedByUserId: number;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
}

/** `startedBy` is whoever opened the session; when `resumed` and not you, another phone has it. */
export interface StartedSession {
  session: ReceivingSession;
  lines: ReceivingLine[];
  resumed: boolean;
  startedBy: { userId: number; userName: string } | null;
}

export interface PurchaseOrderDetail {
  poId: string;
  poNumber: string;
  status: string;
  supplierName: string | null;
  supplierPhone: string | null;
  totalValue: string | null;
  notes: string | null;
  expectedDeliveryDate: string | null;
  lines: Array<{ lineId: string; ingredientName: string | null; orderedQty: string; orderedUnit: string; unitCost: string | null }>;
}

const INVENTORY = "/api/inventory";

/** The calls the receiving screens make. Receiving is online-only: every call reaches the screen as an answer or an ApiError. */
export function createReceivingApi(client: ApiClient) {
  return {
    /** Deliveries waiting at this location, soonest expected first. The server filters, so an old SENT PO never drops off a page. */
    async queue(locationId: string): Promise<QueueItem[]> {
      const q = new URLSearchParams({ status: "SENT,RECEIVING", sort: "expected", limit: "100", storeLocationId: locationId });
      return client.request<QueueItem[]>("GET", `${INVENTORY}/purchase-orders?${q}`);
    },

    purchaseOrder(poId: string): Promise<PurchaseOrderDetail> {
      return client.request<PurchaseOrderDetail>("GET", `${INVENTORY}/purchase-orders/${poId}`);
    },

    /** Starts the delivery, or resumes the one already open for this order. */
    startSession(poId: string, storeLocationId: string): Promise<StartedSession> {
      return client.request<StartedSession>("POST", `${INVENTORY}/receiving/sessions`, { body: { poId, storeLocationId } });
    },

    /** The server's saved line is the truth: the screen shows what comes back, never what it hoped to send. */
    async actionLine(sessionId: string, lineId: string, input: LineInput): Promise<ReceivingLine> {
      return (await client.request<{ line: ReceivingLine }>("POST", `${INVENTORY}/receiving/sessions/${sessionId}/lines/${lineId}`, { body: input })).line;
    },

    confirm(sessionId: string): Promise<ConfirmResult> {
      return client.request<ConfirmResult>("POST", `${INVENTORY}/receiving/sessions/${sessionId}/confirm`);
    },

    async cancel(sessionId: string): Promise<void> {
      await client.request("POST", `${INVENTORY}/receiving/sessions/${sessionId}/cancel`);
    },
  };
}

export type ReceivingApi = ReturnType<typeof createReceivingApi>;
