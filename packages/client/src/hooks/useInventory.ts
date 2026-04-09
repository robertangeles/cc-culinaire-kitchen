/**
 * @module hooks/useInventory
 *
 * Custom hooks for the Inventory System — ingredient catalog,
 * stock take sessions, and location dashboard data.
 */

import { useState, useEffect, useCallback } from "react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export interface Ingredient {
  ingredientId: string;
  organisationId: number;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  description: string | null;
  unitCost: string | null;
  parLevel: string | null;
  reorderQty: string | null;
  containsDairyInd: boolean;
  containsGlutenInd: boolean;
  containsNutsInd: boolean;
  containsShellfishInd: boolean;
  containsEggsInd: boolean;
  isVegetarianInd: boolean;
  itemType: string;
  fifoApplicable: string;
  createdDttm: string;
  updatedDttm: string;
}

export interface LocationIngredient {
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
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
  // Stock
  currentQty: string | null;
  lastCountedDttm: string | null;
}

export interface Supplier {
  supplierId: string;
  organisationId: number;
  supplierName: string;
  supplierCategory: string | null;
  paymentTerms: string | null;
  orderingMethod: string | null;
  deliveryDays: string | null;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  leadTimeDays: number | null;
  minimumOrderValue: string | null;
  notes: string | null;
  activeInd: boolean;
  createdDttm: string;
  updatedDttm: string;
}

export interface UnitConversion {
  conversionId: string;
  ingredientId: string;
  fromUnit: string;
  toBaseFactor: string;
  createdDttm: string;
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

// ─── useIngredients ───────────────────────────────────────────────

export function useIngredients() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/ingredients`, opts);
      if (res.ok) setIngredients(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const create = useCallback(async (data: {
    ingredientName: string;
    ingredientCategory: string;
    baseUnit: string;
    description?: string;
    unitCost?: string;
    parLevel?: string;
    reorderQty?: string;
    containsDairyInd?: boolean;
    containsGlutenInd?: boolean;
    containsNutsInd?: boolean;
    containsShellfishInd?: boolean;
    containsEggsInd?: boolean;
    isVegetarianInd?: boolean;
    itemType?: string;
    fifoApplicable?: string;
  }) => {
    const res = await fetch(`${API}/ingredients`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create ingredient");
    }
    const created = await res.json();
    await refresh();
    return created as Ingredient;
  }, [refresh]);

  const update = useCallback(async (id: string, data: Partial<Ingredient>) => {
    const res = await fetch(`${API}/ingredients/${id}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update ingredient");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ingredients, isLoading, refresh, create, update };
}

// ─── useLocationIngredients ───────────────────────────────────────

export function useLocationIngredients(locationId: string | null) {
  const [items, setItems] = useState<LocationIngredient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/locations/${locationId}/ingredients`, opts);
      if (res.ok) setItems(await res.json());
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

export interface OrgLocationSummary {
  storeLocationId: string;
  locationName: string;
  totalItems: number;
  lowStock: number;
  critical: number;
  inventoryValue: number;
  lastCountDttm: string | null;
}

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

// ─── useIngredientSuppliers ────────────────────────────────────────

export interface IngredientSupplierLink {
  ingredientSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactName: string | null;
  costPerUnit: string | null;
  supplierItemCode: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: string | null;
  preferredInd: boolean;
  activeInd: boolean;
}

export function useIngredientSuppliers(ingredientId: string | null) {
  const [suppliers, setSuppliers] = useState<IngredientSupplierLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!ingredientId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/ingredients/${ingredientId}/suppliers`, opts);
      if (res.ok) setSuppliers(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [ingredientId]);

  const assign = useCallback(async (data: {
    supplierId: string;
    costPerUnit?: string;
    supplierItemCode?: string;
    leadTimeDays?: number;
    minimumOrderQty?: string;
    preferredInd?: boolean;
  }) => {
    if (!ingredientId) return;
    const res = await fetch(`${API}/ingredients/${ingredientId}/suppliers`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to assign supplier");
    }
    await refresh();
    return res.json();
  }, [ingredientId, refresh]);

  const updateLink = useCallback(async (supplierId: string, data: {
    costPerUnit?: string | null;
    supplierItemCode?: string | null;
    preferredInd?: boolean;
  }) => {
    if (!ingredientId) return;
    const res = await fetch(`${API}/ingredients/${ingredientId}/suppliers/${supplierId}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update");
    }
    await refresh();
  }, [ingredientId, refresh]);

  const removeLink = useCallback(async (supplierId: string) => {
    if (!ingredientId) return;
    const res = await fetch(`${API}/ingredients/${ingredientId}/suppliers/${supplierId}`, {
      ...jsonOpts, method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to remove");
    }
    await refresh();
  }, [ingredientId, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { suppliers, isLoading, refresh, assign, updateLink, removeLink };
}

// ─── useIngredientStock ───────────────────────────────────────────

export interface IngredientStockLevel {
  storeLocationId: string;
  locationName: string;
  currentQty: string | null;
  parLevel: string | null;
  reorderQty: string | null;
  lastCountedDttm: string | null;
  unitCost: string | null;
}

export function useIngredientStock(ingredientId: string | null) {
  const [levels, setLevels] = useState<IngredientStockLevel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!ingredientId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/ingredients/${ingredientId}/stock-levels`, opts);
      if (res.ok) setLevels(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [ingredientId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { levels, isLoading, refresh };
}

// ─── useSuppliers ─────────────────────────────────────────────────

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/suppliers`, opts);
      if (res.ok) setSuppliers(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const create = useCallback(async (data: {
    supplierName: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    leadTimeDays?: number;
    minimumOrderValue?: string;
    notes?: string;
  }) => {
    const res = await fetch(`${API}/suppliers`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create supplier");
    }
    const created = await res.json();
    await refresh();
    return created as Supplier;
  }, [refresh]);

  const update = useCallback(async (id: string, data: Partial<Supplier>) => {
    const res = await fetch(`${API}/suppliers/${id}`, {
      ...jsonOpts, method: "PATCH", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update supplier");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`${API}/suppliers/${id}`, {
      ...jsonOpts, method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to delete supplier");
    }
    await refresh();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { suppliers, isLoading, refresh, create, update, remove };
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
  categoryCount: number;
  submittedCount: number;
  categories: StockTakeCategory[];
}

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
