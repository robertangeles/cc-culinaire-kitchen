import { useCallback, useEffect, useRef, useState } from "react";
import type { PurchaseOrderDetail, ReceivingApi, ReceivingSession } from "./receivingApi";
import { failureMessage, isAlreadyDone, type ConfirmResult, type LineInput, type ReceivingLine } from "./receivingFlow";

export type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" }
  | { kind: "done"; result: ConfirmResult }
  | { kind: "gone"; message: string };

/**
 * One delivery being received. The server holds the truth: every line change waits for the server's
 * answer and shows what came back, a failed save leaves the line as it was and says so (the web
 * swallowed those and confirmed anyway), and Confirm waits until nothing is saving.
 */
export function useReceivingSession(api: ReceivingApi, poId: string, currentUserId: number) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [session, setSession] = useState<ReceivingSession | null>(null);
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [otherStarter, setOtherStarter] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const detail = await api.purchaseOrder(poId);
      const started = await api.startSession(poId, detail.storeLocationId);
      if (!alive.current) return;
      setPo(detail);
      setSession(started.session);
      setLines(started.lines);
      setOtherStarter(started.resumed && started.startedBy && started.startedBy.userId !== currentUserId ? started.startedBy.userName : null);
      setPhase({ kind: "ready" });
    } catch (err) {
      if (alive.current) setPhase({ kind: "error", message: failureMessage(err) });
    }
  }, [api, poId, currentUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = (id: string, on: boolean) =>
    setSaving((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Returns true when the server accepted the change (the screen closes the line's panel on true). */
  const act = useCallback(
    async (lineId: string, input: LineInput): Promise<boolean> => {
      if (!session) return false;
      mark(lineId, true);
      setLineErrors(({ [lineId]: _drop, ...rest }) => rest);
      try {
        const saved = await api.actionLine(session.sessionId, lineId, input);
        if (alive.current) setLines((all) => all.map((l) => (l.receivingLineId === lineId ? { ...l, ...saved } : l)));
        return true;
      } catch (err) {
        if (alive.current) setLineErrors((e) => ({ ...e, [lineId]: failureMessage(err) }));
        return false;
      } finally {
        if (alive.current) mark(lineId, false);
      }
    },
    [api, session],
  );

  const confirm = useCallback(async () => {
    if (!session || saving.size > 0 || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const result = await api.confirm(session.sessionId);
      if (alive.current) setPhase({ kind: "done", result });
    } catch (err) {
      if (!alive.current) return;
      if (isAlreadyDone(err)) setPhase({ kind: "gone", message: "This delivery was already confirmed." });
      else setConfirmError(failureMessage(err));
    } finally {
      if (alive.current) setConfirming(false);
    }
  }, [api, session, saving, confirming]);

  /** Cancelling discards the session (nothing reaches stock) and puts the order back in the queue. */
  const cancel = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    try {
      await api.cancel(session.sessionId);
      return true;
    } catch (err) {
      if (alive.current) setConfirmError(failureMessage(err));
      return false;
    }
  }, [api, session]);

  return { phase, po, lines, otherStarter, saving, lineErrors, confirming, confirmError, act, confirm, cancel, reload: load };
}
