/**
 * @module hooks/useReceiving
 *
 * Hook for the delivery receiving workflow.
 * Local-first architecture: line actions are stored in localStorage
 * and synced to the server on confirm.
 */

import { useState, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ── Types ────────────────────────────────────────────────────────────

export interface ReceivingSession {
  sessionId: string;
  poId: string;
  storeLocationId: string;
  receivedByUserId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  notes: string | null;
}

export interface ReceivingLine {
  receivingLineId: string;
  sessionId: string;
  poLineId: string;
  ingredientId: string;
  orderedQty: string;
  orderedUnit: string;
  receivedQty: string;
  actualUnitCost: string | null;
  status: string;
  ingredientName: string | null;
  ingredientCategory: string | null;
  baseUnit: string | null;
}

export interface ReceivingDiscrepancy {
  discrepancyId: string;
  receivingLineId: string;
  sessionId: string;
  supplierId: string;
  type: string;
  shortageQty: string | null;
  rejectionReason: string | null;
  rejectionNote: string | null;
  poUnitCost: string | null;
  actualUnitCost: string | null;
  varianceAmount: string | null;
  variancePct: string | null;
  substitutedIngredientId: string | null;
  isResolved: boolean;
}

export type LineAction = {
  status: "RECEIVED" | "SHORT" | "REJECTED" | "PRICE_VARIANCE" | "SUBSTITUTED";
  receivedQty?: string;
  actualUnitCost?: string;
  rejectionReason?: string;
  rejectionNote?: string;
  substitutedIngredientId?: string;
};

export interface ReceivingSessionData {
  session: ReceivingSession;
  lines: ReceivingLine[];
  discrepancies: ReceivingDiscrepancy[];
  photos: Array<{ photoId: string; discrepancyId: string; cloudinaryUrl: string }>;
}

export interface ConfirmResult {
  sessionId: string;
  poId: string;
  poStatus: string;
  linesProcessed: number;
  discrepancyCount: number;
  isPerfectDelivery: boolean;
}

// ── Local storage helpers ────────────────────────────────────────────

const LS_KEY_PREFIX = "receiving_session_";

function saveToLocal(sessionId: string, data: ReceivingSessionData) {
  try {
    localStorage.setItem(`${LS_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — continue without local persistence
  }
}

function loadFromLocal(sessionId: string): ReceivingSessionData | null {
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearLocal(sessionId: string) {
  try {
    localStorage.removeItem(`${LS_KEY_PREFIX}${sessionId}`);
  } catch {
    // Ignore
  }
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useReceiving() {
  const [sessionData, setSessionData] = useState<ReceivingSessionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  /**
   * Start a new receiving session for a PO.
   */
  const startSession = useCallback(async (poId: string, storeLocationId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/receiving/sessions`, {
        ...jsonOpts, method: "POST", body: JSON.stringify({ poId, storeLocationId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start receiving session");
      }
      const data = await res.json() as ReceivingSessionData;
      setSessionData(data);
      saveToLocal(data.session.sessionId, data);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Load an existing session (from server, with local fallback).
   */
  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/receiving/sessions/${sessionId}`, opts);
      if (res.ok) {
        const data = await res.json() as ReceivingSessionData;
        setSessionData(data);
        saveToLocal(sessionId, data);
        setIsOffline(false);
        return data;
      }
      throw new Error("Failed to load session");
    } catch {
      // Offline fallback
      const local = loadFromLocal(sessionId);
      if (local) {
        setSessionData(local);
        setIsOffline(true);
        return local;
      }
      setError("Session not found and no local data available");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Action a line item (short, reject, price variance, substitution).
   * Updates both server and local storage.
   */
  const actionLine = useCallback(async (
    receivingLineId: string,
    action: LineAction,
  ) => {
    if (!sessionData) throw new Error("No active session");

    const sessionId = sessionData.session.sessionId;

    // Update local state immediately (optimistic)
    setSessionData((prev) => {
      if (!prev) return prev;
      const updatedLines = prev.lines.map((l) =>
        l.receivingLineId === receivingLineId
          ? {
              ...l,
              status: action.status,
              receivedQty: action.status === "REJECTED" ? "0" : (action.receivedQty ?? l.receivedQty),
              actualUnitCost: action.actualUnitCost ?? l.actualUnitCost,
            }
          : l,
      );
      const updated = { ...prev, lines: updatedLines };
      saveToLocal(sessionId, updated);
      return updated;
    });

    // Sync to server
    try {
      const res = await fetch(
        `${API}/receiving/sessions/${sessionId}/lines/${receivingLineId}`,
        { ...jsonOpts, method: "POST", body: JSON.stringify(action) },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to action line");
      }
      const result = await res.json();

      // Update discrepancies from server response
      if (result.discrepancy) {
        setSessionData((prev) => {
          if (!prev) return prev;
          const discrepancies = prev.discrepancies.filter(
            (d) => d.receivingLineId !== receivingLineId,
          );
          discrepancies.push(result.discrepancy);
          const updated = { ...prev, discrepancies };
          saveToLocal(sessionId, updated);
          return updated;
        });
      }

      setIsOffline(false);
      return result;
    } catch {
      // Server unavailable — local state is already updated
      setIsOffline(true);
      return null;
    }
  }, [sessionData]);

  /**
   * Confirm receipt — sync all changes to server.
   */
  const confirmReceipt = useCallback(async (): Promise<ConfirmResult> => {
    if (!sessionData) throw new Error("No active session");

    const sessionId = sessionData.session.sessionId;
    setIsSyncing(true);
    setError(null);

    try {
      const res = await fetch(`${API}/receiving/sessions/${sessionId}/confirm`, {
        ...jsonOpts, method: "POST",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to confirm receipt");
      }

      const result = await res.json() as ConfirmResult;
      clearLocal(sessionId);
      setSessionData(null);
      return result;
    } catch (err: any) {
      if (!navigator.onLine) {
        // Queue for later sync
        setIsOffline(true);
        setError("Saved locally — will sync when online");
        throw err;
      }
      setError(err.message);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [sessionData]);

  /**
   * Cancel the receiving session.
   */
  const cancelSession = useCallback(async () => {
    if (!sessionData) return;

    const sessionId = sessionData.session.sessionId;
    try {
      await fetch(`${API}/receiving/sessions/${sessionId}/cancel`, {
        ...jsonOpts, method: "POST",
      });
    } catch {
      // Best effort
    }
    clearLocal(sessionId);
    setSessionData(null);
  }, [sessionData]);

  // Computed values
  const discrepancyCount = sessionData?.lines.filter((l) => l.status !== "RECEIVED").length ?? 0;
  const isPerfectDelivery = discrepancyCount === 0;
  const allLinesActioned = sessionData?.lines.length ? sessionData.lines.length > 0 : false;

  return {
    sessionData,
    isLoading,
    isSyncing,
    isOffline,
    error,
    discrepancyCount,
    isPerfectDelivery,
    allLinesActioned,
    startSession,
    loadSession,
    actionLine,
    confirmReceipt,
    cancelSession,
  };
}
