import { vi } from "vitest";
import type { ReactNode } from "react";
import { DiscrepancySchema, OrderDetailSchema, OrderGuideItemSchema, OrderItemSchema, OrderSummarySchema } from "@culinaire/shared/schemas/purchasing";
import type { AuthUser } from "../src/api/auth";
import type { OrdersApi } from "../src/orders/ordersApi";
import { createOrders } from "../src/orders/orders";
import { OrdersContextProvider } from "../src/orders/OrdersProvider";
import type { KvStore } from "../src/storage/kv";
import { sessionState } from "../testing/mocks";

export const memoryKv = (): KvStore => {
  const data = new Map<string, string>();
  return { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
};

export const person = (permissions: string[], roles: string[] = []): AuthUser => ({ userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles, permissions });
export const admin = person([], ["Administrator"]);
export const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

export const order = (over: object = {}) =>
  OrderSummarySchema.parse({ poId: "P1", poNumber: "PO-100", status: "DRAFT", storeLocationId: "L1", locationName: "Main Kitchen", supplierId: "s1", supplierName: "Fresh Farms", createdByUserId: 1, createdByUserName: "Chef", createdDttm: "2026-11-20T01:00:00Z", lineCount: 1, totalValue: "35.00", ...over });
const line = { lineId: "l1", ingredientId: "i1", ingredientName: "Flour", orderedQty: "2.0000", orderedUnit: "bag", unitCost: "17.5000", lineStatus: "PENDING" };
/** What the detail route sends: the list's fields less the three it leaves out, and the lines. */
export const detail = (over: object = {}, lineOver: object = {}) => {
  const { submittedAt: _s, supplierOrderingMethod: _m, lineCount: _l, ...rest } = order(over);
  return OrderDetailSchema.parse({ ...rest, lines: [{ ...line, ...lineOver }] });
};
export const flour = OrderItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", packQty: "12.5", currentQty: "4", parLevel: "25", orgUnitCost: "1.40" });
export const gin = OrderItemSchema.parse({ ingredientId: "i2", ingredientName: "Gin", baseUnit: "bottle" });
export const guideItem = OrderGuideItemSchema.parse({ ingredientId: "i1", ingredientName: "Flour", baseUnit: "kg", purchaseUnit: "bag", packQty: 12.5, onHand: 0, parLevel: 25, suggestedOrderQty: 25, suggestedPackages: 2, unitCost: 1.4, packUnitCost: 17.5, supplierMinOrderQty: 3 });
export const discrepancy = (over: object = {}) =>
  DiscrepancySchema.parse({ discrepancyId: "d1", type: "SHORT", poId: "P1", poNumber: "PO-100", locationName: "Main Kitchen", supplierId: "s1", supplierName: "Fresh Farms", ingredientName: "Flour", orderedQty: "5", orderedUnit: "kg", receivedQty: "3", shortageQty: "2", createdAt: "2026-11-20T01:00:00Z", maxCreditAmount: 8, ...over });

export const api = {
  list: vi.fn(), detail: vi.fn(), create: vi.fn(), submit: vi.fn(), cancel: vi.fn(), approve: vi.fn(), reject: vi.fn(), email: vi.fn(), clone: vi.fn(),
  suppliers: vi.fn(), supplierItemIds: vi.fn(), items: vi.fn(), guides: vi.fn(), guideItems: vi.fn(), discrepancies: vi.fn(), creditNotes: vi.fn(), credit: vi.fn(),
} satisfies Record<keyof OrdersApi, ReturnType<typeof vi.fn>>;

/** The plain answers; a test changes the ones it is about. */
export function resetApi() {
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockResolvedValue([order()]);
  api.detail.mockResolvedValue(detail());
  api.create.mockResolvedValue({ poId: "P9", poNumber: "PO-900", skippedItems: [] });
  api.submit.mockResolvedValue({ poId: "P1", status: "SENT" });
  api.email.mockResolvedValue({ emailed: true, to: "orders@farms.test", message: null });
  api.clone.mockResolvedValue({ poId: "P9", poNumber: "PO-900", skippedItems: [] });
  api.suppliers.mockResolvedValue([{ supplierId: "s1", supplierName: "Fresh Farms" }]);
  api.supplierItemIds.mockResolvedValue([]);
  api.items.mockResolvedValue([flour, gin]);
  api.guides.mockResolvedValue([]);
  api.guideItems.mockResolvedValue([guideItem]);
  api.discrepancies.mockResolvedValue([]);
  api.creditNotes.mockResolvedValue([]);
}

/** The screens' surroundings for one person, over the fake server. `kv` is the phone's storage, shared to act out a restart. */
export function ordersFor(user: AuthUser, kv: KvStore = memoryKv()) {
  sessionState.current = { state: { phase: "ready", user, location: main, locations: [main] }, busy: false };
  const ctx = createOrders({ api: api as unknown as OrdersApi, kv, user, locationId: "L1", now: () => "2026-11-25T08:00:00Z" });
  return { ctx, wrapper: ({ children }: { children: ReactNode }) => <OrdersContextProvider value={ctx}>{children}</OrdersContextProvider> };
}
