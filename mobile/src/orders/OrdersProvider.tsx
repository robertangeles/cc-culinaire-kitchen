import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { AuthUser } from "../api/auth";
import { client } from "../runtime/appContext";
import { sqliteKv } from "../storage/kv";
import type { CachedList } from "./cachedList";
import { createOrders, type OrdersCtx } from "./orders";
import { createOrdersApi } from "./ordersApi";

const OrdersContext = createContext<OrdersCtx | null>(null);

/** The orders module: its lists and the order being written live as long as the tab, one set per location and account. */
export function OrdersProvider({ user, locationId, children }: { user: AuthUser; locationId: string; children: ReactNode }) {
  // By what the account is, not by the object: the session hands out a new one each time it checks in, and an order being typed must survive that.
  const account = JSON.stringify([user.userId, user.roles, user.permissions]);
  const ctx = useMemo(() => createOrders({ api: createOrdersApi(client), kv: sqliteKv, user, locationId, now: () => new Date().toISOString() }), [account, locationId]);
  useEffect(() => {
    void ctx.draft.restore();
  }, [ctx]);
  return <OrdersContext.Provider value={ctx}>{children}</OrdersContext.Provider>;
}

/** Test seam: the screens on a set of orders the test made. */
export const OrdersContextProvider = OrdersContext.Provider;

export function useOrders(): OrdersCtx {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error("order screens must be inside OrdersProvider");
  return ctx;
}

export function useList<T>(list: CachedList<T>) {
  return useSyncExternalStore(list.subscribe, list.getSnapshot);
}

export function useDraft() {
  const { draft } = useOrders();
  return { store: draft, snap: useSyncExternalStore(draft.subscribe, draft.getSnapshot) };
}
