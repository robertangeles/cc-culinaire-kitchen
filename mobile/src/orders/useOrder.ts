import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderDetail, OrderSummary } from "@culinaire/shared/schemas/purchasing";
import type { OrdersApi } from "./ordersApi";
import { loadMessage, orderFailure } from "./orderView";

/** What an action did: `notice` is something to tell the person, good or bad. */
export interface Notice {
  text: string;
  bad: boolean;
}

/**
 * One order. The server holds the truth: after every action it is read again, and an action whose answer was lost counts as done only when
 * the order shows it. With no signal the list's row (`known`) is shown without its items.
 */
export function useOrder(api: OrdersApi, poId: string, known: OrderSummary | undefined) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const load = useCallback(async (): Promise<OrderDetail | null> => {
    try {
      const next = await api.detail(poId);
      if (alive.current) {
        setDetail(next);
        setError(null);
      }
      return next;
    } catch (err) {
      if (alive.current) setError(loadMessage(err));
      return null;
    }
  }, [api, poId]);

  /** `name` is the action shown as busy, `doing` finishes "... needs a connection". Returns true when it was done. */
  const act = useCallback(
    async (name: string, doing: string, run: () => Promise<Notice | string | void>): Promise<boolean> => {
      // A ref, not the state: two taps in one frame both see the state as it was.
      if (working.current) return false;
      working.current = true;
      setBusy(name);
      setNotice(null);
      const before = detail?.status;
      try {
        const said = await run();
        await load();
        if (alive.current && said) setNotice(typeof said === "string" ? { text: said, bad: false } : said);
        return true;
      } catch (err) {
        const f = orderFailure(err, doing);
        const now = f.unsure || f.moved ? await load() : null;
        if (f.unsure && now && before && now.status !== before) return true;
        if (alive.current) setNotice({ text: f.message, bad: true });
        return false;
      } finally {
        working.current = false;
        if (alive.current) setBusy(null);
      }
    },
    [detail?.status, load],
  );

  // The detail does not send these three; the list's row has them when the order was opened from it.
  const order: OrderSummary | null = detail
    ? { ...detail, submittedAt: detail.submittedAt ?? known?.submittedAt ?? null, supplierOrderingMethod: detail.supplierOrderingMethod ?? known?.supplierOrderingMethod ?? null, lineCount: detail.lines.length }
    : known ?? null;

  return { order, lines: detail?.lines ?? null, detail, error, busy, notice, setNotice, load, act };
}
