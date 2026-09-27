/**
 * @module hooks/useStockTake
 * Hooks for stock taking — sessions, categories, lines, review workflow,
 * location inventory state, consumption logging, and dashboard data.
 */

import { useState, useEffect, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export interface LocationIngredient {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  itemType: string;
  /** THE kitchen unit — stock/counts/display all live in this unit. No lens. */
  baseUnit: string;
  contentQty: string | null;
  contentUnit: string | null;
  purchaseUnit: string | null;
  packQty: string | null;
  description: string | null;
  orgUnitCost: string | null;
  orgParLevel: string | null;
  orgReorderQty: string | null;
  // Allergens
  containsDairyInd: boolean;
  containsGlutenInd: boolean;
  containsNutsInd: boolean;
  containsShellfishInd: boolean;
  containsEggsInd: boolean;
  isVegetarianInd: boolean;
  // Location overrides
  locationIngredientId: string | null;
  parLevel: string | null;
  reorderQty: string | null;
  locationUnitCost: string | null;
  unitOverride: string | null;
  categoryOverride: string | null;
  activeInd: boolean | null;
  // Supplier
  supplierId: string | null;
  supplierName: string | null;
  /** The supplier's real minimum order quantity — NOT the internal reorder trigger. */
  supplierMinOrderQty: string | null;
  // Stock
  currentQty: string | null;
  lastCountedDttm: string | null;
}

export interface StockTakeSession {
  sessionId: string;
  storeLocationId: string;
  organisationId: number;
  sessionStatus: string;
  openedByUserId: number;
  approvedByUserId: number | null;
  flagReason: string | null;
  openedDttm: string;
  submittedDttm: string | null;
  closedDttm: string | null;
  categories: StockTakeCategory[];
  // Enriched fields (from JOINs)
  openedByUserName?: string;
  approvedByUserName?: string | null;
  locationName?: string;
}

export interface StockTakeCategory {
  categoryId: string;
  sessionId: string;
  categoryName: string;
  categoryStatus: string;
  claimedByUserId: number | null;
  flagReason: string | null;
  submittedDttm: string | null;
  lineCount?: number;
  lines?: StockTakeLine[];
  // Enriched
  claimedByUserName?: string | null;
}

export interface StockTakeLine {
  lineId: string;
  categoryId: string;
  ingredientId: string;
  countedQty: string;
  countedUnit: string;
  rawQty: string;
  expectedQty: string | null;
  varianceQty: string | null;
  variancePct: string | null;
  countedByUserId: number;
  countedDttm: string;
  // Enriched
  ingredientName?: string;
  ingredientCategory?: string;
  baseUnit?: string;
  countedByUserName?: string;
  /** Cost per counting (base) unit — for the variance $ value; not stored on the line. */
  unitCost?: string | null;
}

export interface SetupProgress {
  locationCreated: boolean;
  itemsActivated: boolean;
  itemsActivatedCount: number;
  parLevelsSet: boolean;
  parLevelsCount: number;
  openingCountCompleted: boolean;
  inventoryActive: boolean;
}

export interface DashboardData {
  stockLevels: LocationIngredient[];
  activeSession: StockTakeSession | null;
  lastCompletedSession: StockTakeSession | null;
  setupProgress?: SetupProgress;
}

export interface ConsumptionLogEntry {
  consumptionLogId: string;
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  quantity: string;
  unit: string;
  reason: string;
  notes: string | null;
  shift: string | null;
  loggedAt: string;
  userName?: string;
}

export interface OrgLocationSummary {
  storeLocationId: string;
  locationName: string;
  totalItems: number;
  lowStock: number;
  critical: number;
  inventoryValue: number;
  lastCountDttm: string | null;
}

export interface PendingReviewSession {
  sessionId: string;
  storeLocationId: string;
  locationName: string;
  sessionStatus: string;
  openedByUserId: number;
  openedByUserName: string;
  openedDttm: string;
  submittedDttm: string | null;
  flagReason: string | null;
  /** History only: who approved it + when. */
  approvedByUserName?: string;
  closedDttm?: string | null;
  categoryCount: number;
  submittedCount: number;
  categories: StockTakeCategory[];
}

// ─── useLocationIngredients ───────────────────────────────────────

/**
 * Share an in-flight location-ingredients request between concurrent callers.
 *
 * The PO list and the PO form both mount at once and both need this list, so each
 * was firing its own identical GET. This is NOT a cache — the entry is dropped the
 * moment the request settles, so any later refresh still hits the server. It only
 * collapses the simultaneous duplicates.
 */
const inFlightLocationIngredients = new Map<string, Promise<LocationIngredient[] | null>>();

function fetchLocationIngredients(locationId: string): Promise<LocationIngredient[] | null> {
  const existing = inFlightLocationIngredients.get(locationId);
  if (existing) return existing;

  const request = (async (): Promise<LocationIngredient[] | null> => {
    try {
      const res = await fetch(`${API}/locations/${locationId}/ingredients`, opts);
      // null = "leave what's on screen alone" (matches the previous behaviour of
      // only calling setItems on a successful response).
      if (!res.ok) return null;
      return (await res.json()) as LocationIngredient[];
    } catch {
      return null;
    }
  })();

  inFlightLocationIngredients.set(locationId, request);
  void request.finally(() => inFlightLocationIngredients.delete(locationId));
  return request;
}

export function useLocationIngredients(locationId: string | null) {
  const [items, setItems] = useState<LocationIngredient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const data = await fetchLocationIngredients(locationId);
      if (data) setItems(data);
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  const updateConfig = useCallback(async (
    ingredientId: string,
    data: { parLevel?: string; reorderQty?: string; unitOverride?: string | null; activeInd?: boolean },
  ) => {
    if (!locationId) return;
    const res = await fetch(`${API}/locations/${locationId}/ingredients/${ingredientId}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update config");
    }
    await refresh();
  }, [locationId, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, isLoading, refresh, updateConfig };
}

// ─── useOrgDashboard ──────────────────────────────────────────────

export function useOrgDashboard() {
  const [locations, setLocations] = useState<OrgLocationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/dashboard/org-summary`, opts);
      if (res.ok) setLocations(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { locations, isLoading, refresh };
}

// ─── useStockTake ─────────────────────────────────────────────────

export function useStockTake() {
  const [session, setSession] = useState<StockTakeSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshActive = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/stock-takes/active`, opts);
      if (res.ok) {
        const data = await res.json();
        setSession(data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openSession = useCallback(async (categories?: string[]) => {
    const res = await fetch(`${API}/stock-takes`, {
      ...jsonOpts, method: "POST",
      body: JSON.stringify(categories ? { categories } : {}),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to open session");
    }
    const data = await res.json();
    setSession(data);
    return data as StockTakeSession;
  }, []);

  const getDetail = useCallback(async (sessionId: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}`, opts);
    if (res.ok) {
      const data = await res.json();
      setSession(data);
      return data as StockTakeSession;
    }
    return null;
  }, []);

  const claimCategory = useCallback(async (sessionId: string, categoryName: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/categories/${categoryName}/claim`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to claim category");
    }
    await getDetail(sessionId);
    return res.json();
  }, [getDetail]);

  const saveLine = useCallback(async (
    sessionId: string,
    categoryName: string,
    data: { ingredientId: string; rawQty: number; countedUnit: string },
  ) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/categories/${categoryName}/lines`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to save line item");
    }
    return res.json() as Promise<StockTakeLine>;
  }, []);

  const getLines = useCallback(async (sessionId: string, categoryName: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/categories/${categoryName}/lines`, opts);
    if (res.ok) return res.json() as Promise<StockTakeLine[]>;
    return [];
  }, []);

  const submitCategory = useCallback(async (sessionId: string, categoryName: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/categories/${categoryName}/submit`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to submit category");
    }
    await getDetail(sessionId);
    return res.json();
  }, [getDetail]);

  const submitForReview = useCallback(async (sessionId: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/submit-for-review`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to submit for review");
    }
    await getDetail(sessionId);
  }, [getDetail]);

  const approveSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/approve`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to approve session");
    }
    await getDetail(sessionId);
  }, [getDetail]);

  const flagSession = useCallback(async (
    sessionId: string,
    flaggedCategories: string[],
    reason: string,
  ) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/flag`, {
      ...jsonOpts, method: "POST",
      body: JSON.stringify({ flaggedCategories, reason }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to flag session");
    }
    await getDetail(sessionId);
  }, [getDetail]);

  const getPreviousLines = useCallback(async (sessionId: string, categoryName: string) => {
    const res = await fetch(`${API}/stock-takes/${sessionId}/previous-lines/${categoryName}`, opts);
    if (res.ok) return res.json() as Promise<StockTakeLine[]>;
    return [];
  }, []);

  useEffect(() => { refreshActive(); }, [refreshActive]);

  return {
    session, isLoading, refreshActive, openSession, getDetail,
    claimCategory, saveLine, getLines, submitCategory, submitForReview,
    approveSession, flagSession, getPreviousLines,
  };
}

// ─── usePendingReviews ────────────────────────────────────────────

export function usePendingReviews() {
  const [sessions, setSessions] = useState<PendingReviewSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/stock-takes/pending-reviews`, opts);
      if (res.ok) setSessions(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { sessions, isLoading, refresh };
}

/** Approved (closed) stock-take sessions for the HQ-only History view. */
export function useStockTakeHistory() {
  const [sessions, setSessions] = useState<PendingReviewSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/stock-takes/history`, opts);
      if (res.ok) setSessions(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { sessions, isLoading, refresh };
}

// ─── useDashboard ─────────────────────────────────────────────────

export function useDashboard(locationId: string | null) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/locations/${locationId}/dashboard`, opts);
      if (res.ok) setData(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, isLoading, refresh };
}

// ─── useConsumptionLog ───────────────────────────────────────────

export function useConsumptionLog(locationId: string | null) {
  const [logs, setLogs] = useState<ConsumptionLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/consumption-logs?storeLocationId=${locationId}`, opts);
      if (res.ok) setLogs(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  const logConsumption = useCallback(async (data: {
    ingredientId: string;
    /** Phase 4 (B1): optional dish attribution. Powers per-dish yield variance. */
    menuItemId?: string | null;
    quantity: number;
    unit: string;
    reason: string;
    notes?: string;
    shift?: string;
    storeLocationId: string;
  }) => {
    const res = await fetch(`${API}/consumption-logs`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to log consumption");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const editLog = useCallback(async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`${API}/consumption-logs/${id}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to edit log");
    }
    await refresh();
  }, [refresh]);

  const deleteLog = useCallback(async (id: string) => {
    const res = await fetch(`${API}/consumption-logs/${id}`, {
      ...jsonOpts, method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to delete log");
    }
    await refresh();
  }, [refresh]);

  return { logs, isLoading, logConsumption, editLog, deleteLog, refresh };
}
