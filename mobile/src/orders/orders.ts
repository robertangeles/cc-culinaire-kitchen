/** The orders module's data for one person at one location, without React: the screens get it through `OrdersProvider`. */

import { CreditNoteListSchema, DiscrepancyListSchema, OrderListSchema, type CreditNote, type Discrepancy, type OrderSummary } from "@culinaire/shared/schemas/purchasing";
import type { AuthUser } from "../api/auth";
import type { KvStore } from "../storage/kv";
import { createCachedList, type CachedList } from "./cachedList";
import { createDraftStore, type DraftStore } from "./draftStore";
import { PAGE, type OrdersApi } from "./ordersApi";
import { FILTERS, loadMessage, orderRights, PENDING, type FilterLabel, type OrderRights } from "./orderView";

export interface OrdersCtx {
  api: OrdersApi;
  rights: OrderRights;
  /** One list per filter, kept apart so switching filters shows what that one last had. */
  list(filter: FilterLabel): CachedList<OrderSummary>;
  approvals: CachedList<OrderSummary>;
  discrepancies: CachedList<Discrepancy>;
  credits: CachedList<CreditNote>;
  draft: DraftStore;
  /** The row a list last had for an order: some fields are sent only there. */
  known(poId: string): OrderSummary | undefined;
}

export function createOrders({ api, kv, user, locationId, now }: { api: OrdersApi; kv: KvStore; user: AuthUser; locationId: string; now: () => string }): OrdersCtx {
  const rights = orderRights(user);
  const orders = (name: string, statuses: readonly string[]) =>
    createCachedList<OrderSummary>({ kv, key: `orders.${user.userId}.${locationId}.${name}`, fetch: (offset) => api.list(locationId, statuses, offset), schema: OrderListSchema, id: (o) => o.poId, pageSize: PAGE, message: loadMessage, now });
  const lists = new Map<FilterLabel, CachedList<OrderSummary>>();
  const approvals = orders("approvals", PENDING);
  return {
    api,
    rights,
    list(filter) {
      let list = lists.get(filter);
      if (!list) lists.set(filter, (list = orders(filter, FILTERS.find((f) => f.label === filter)!.statuses)));
      return list;
    },
    approvals,
    // Credit notes are the organisation's, whatever the location.
    discrepancies: createCachedList<Discrepancy>({ kv, key: `orders.${user.userId}.discrepancies`, fetch: (offset) => api.discrepancies(offset), schema: DiscrepancyListSchema, id: (d) => d.discrepancyId, pageSize: PAGE, message: loadMessage, now }),
    credits: createCachedList<CreditNote>({ kv, key: `orders.${user.userId}.credits`, fetch: () => api.creditNotes(), schema: CreditNoteListSchema, id: (n) => n.creditNoteId, pageSize: Infinity, message: loadMessage, now }),
    draft: createDraftStore({ api, kv, key: `orders.draft.${user.userId}.${locationId}`, locationId, userId: user.userId, guidesAllowed: rights.draft }),
    known(poId) {
      return [approvals, ...lists.values()].flatMap((l) => l.getSnapshot().items).find((o) => o.poId === poId);
    },
  };
}
