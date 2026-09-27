/**
 * @module hooks/useIngredientCatalog
 * Hooks for the ingredient catalog and procurement — ingredients, suppliers,
 * purchase orders, inter-location transfers, and AI reorder forecasts.
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
  /** THE kitchen unit — the item is counted/stocked in this unit (g, ml, each, bottle). */
  baseUnit: string;
  /** Content equivalence: 1 kitchen unit contains contentQty contentUnit (1 bottle = 750 ml). */
  contentQty: string | null;
  contentUnit: string | null;
  /** Density g/mL — volume↔mass bridge for the unit resolver. */
  densityGPerMl: string | null;
  /** Primary purchase packaging label (case, bag) — ordering/receiving only. */
  purchaseUnit: string | null;
  /** Kitchen units per purchase package (also the pack-cost helper). */
  packQty: string | null;
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
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
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

export interface IngredientSupplierLink {
  ingredientSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactName: string | null;
  packCost: string | null;
  costPerUnit: string | null;
  supplierItemCode: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: string | null;
  preferredInd: boolean;
  activeInd: boolean;
}

export interface IngredientStockLevel {
  storeLocationId: string;
  locationName: string;
  currentQty: string | null;
  parLevel: string | null;
  reorderQty: string | null;
  lastCountedDttm: string | null;
  unitCost: string | null;
}

/**
 * One event in an item's history, from `GET /ingredients/:id/transactions`.
 *
 * The server merges five sources into this shape (ingredientService
 * `getIngredientTransactions`). Mind the type names — they are NOT what you'd
 * guess:
 *   stock_take   a count
 *   transfer     CONSUMPTION (internal usage). Not a transfer. Historical name.
 *   transfer_loc an inter-LOCATION transfer — the one that really moves stock off site
 *   waste        a waste log
 *   movement     an area-to-area move within one site. ZERO stock effect.
 *
 * This is the single declaration. TransactionDayList imports it rather than
 * keeping its own copy — they had drifted, and this one was missing
 * `transfer_loc` even though the server has always emitted it.
 */
export interface TransactionEvent {
  id: string;
  // "transfer" is consumption/usage (historical name, see TransactionDayList).
  // "receipt" is a delivery received against a purchase order — stock's largest
  // inbound movement, and absent from this union until 2026-08-02.
  type: "stock_take" | "transfer" | "transfer_loc" | "waste" | "movement" | "receipt";
  quantity: string;
  unit: string;
  reason: string | null;
  userName: string;
  occurredAt: string;
  /**
   * Where this event came from, as an app route. Null when the event type has
   * no destination to open — only receipts have one today (the purchase order).
   */
  link: string | null;
}

export interface PurchaseOrder {
  poId: string;
  poNumber: string;
  status: string;
  notes: string | null;
  rejectedReason: string | null;
  totalValue: string | null;
  expectedDeliveryDate: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  supplierEmailedAt: string | null;
  createdDttm: string;
  updatedDttm: string;
  storeLocationId: string;
  supplierId: string;
  createdByUserId: number;
  supplierName: string | null;
  locationName: string | null;
  createdByUserName: string | null;
  supplierOrderingMethod: string | null;
  lineCount: number;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  lineId: string;
  poId: string;
  ingredientId: string;
  orderedQty: string;
  orderedUnit: string;
  receivedQty: string | null;
  receivedUnit: string | null;
  unitCost: string | null;
  actualUnitCost: string | null;
  lineStatus: string;
  receivedByUserId: number | null;
  receivedByUserName: string | null;
  receivedDttm: string | null;
  createdDttm: string;
  ingredientName: string | null;
  baseUnit: string | null;
  ingredientCategory: string | null;
}

export interface Transfer {
  transferId: string;
  organisationId: number;
  fromLocationId: string;
  toLocationId: string;
  status: string;
  notes: string | null;
  sentDttm: string | null;
  receivedDttm: string | null;
  createdDttm: string;
  fromLocationName: string | null;
  toLocationName: string | null;
  initiatorName: string | null;
  lineCount: number;
}

export interface TransferDetail extends Transfer {
  updatedDttm: string;
  initiatedByUserId: number;
  sentByUserId: number | null;
  receivedByUserId: number | null;
  lines: TransferLineDetail[];
}

export interface TransferLineDetail {
  lineId: string;
  ingredientId: string;
  sentQty: string;
  sentUnit: string;
  receivedQty: string | null;
  lineStatus: string;
  fifoBatchId: string | null;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
}

export interface ForecastRecommendation {
  recommendationId: string;
  ingredientId: string;
  predictedDepletionDate: string | null;
  daysRemaining: number | null;
  suggestedOrderQty: string | null;
  confidence: string | null;
  basedOnDays: number | null;
  status: string;
  createdDttm: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  currentQty: string | null;
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
    packQty?: string;
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

  const checkUsage = useCallback(async (id: string) => {
    const res = await fetch(`${API}/ingredients/${id}/usage`, opts);
    if (!res.ok) return [];
    return res.json() as Promise<Array<{ menuItemId: string; menuItemName: string }>>;
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`${API}/ingredients/${id}`, { ...opts, method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to delete ingredient");
    }
    await refresh();
  }, [refresh]);

  return { ingredients, isLoading, refresh, create, update, checkUsage, remove };
}

// ─── useIngredientSuppliers ────────────────────────────────────────

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
    minimumOrderQty?: string | null;
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

// ─── useIngredientTransactions ──────────────────────────────────

export function useIngredientTransactions(ingredientId: string | null, month: string) {
  const [transactions, setTransactions] = useState<TransactionEvent[]>([]);
  const [transactionDates, setTransactionDates] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  /**
   * A failed request used to leave `transactions` empty and silent, so the panel
   * rendered "No activity on this day" — indistinguishable from an item that
   * genuinely had no history. A backend restart, a dropped connection or an
   * expired session all looked like "nothing ever happened to this ingredient",
   * which is a lie about stock records. Surface the failure instead.
   */
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ingredientId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/ingredients/${ingredientId}/transactions?month=${month}`, opts);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setTransactionDates(new Set(data.transactionDates || []));
      } else {
        setError("Couldn't load history.");
      }
    } catch {
      setError("Couldn't load history.");
    } finally {
      setIsLoading(false);
    }
  }, [ingredientId, month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { transactions, transactionDates, isLoading, error, refresh };
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
    website?: string;
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

// ─── usePurchaseOrders ──────────────────────────────────────────

export function usePurchaseOrders(locationId: string | null) {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = locationId ? `?storeLocationId=${locationId}` : "";
      const res = await fetch(`${API}/purchase-orders${params}`, opts);
      if (res.ok) setPOs(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  const getDetail = useCallback(async (poId: string) => {
    // Every failure used to collapse to `null`, so the UI could only ever say
    // "Failed to load details." — a 403, a 500 and the dev server restarting
    // under you were indistinguishable. Say which one it was.
    let res: Response;
    try {
      res = await fetch(`${API}/purchase-orders/${poId}`, opts);
    } catch {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    if (res.ok) return res.json() as Promise<PurchaseOrder>;
    if (res.status === 401) throw new Error("Your session expired. Sign in again.");
    if (res.status === 403) throw new Error("You don't have access to this purchase order.");
    if (res.status === 404) throw new Error("This purchase order no longer exists.");
    if (res.status >= 500) throw new Error(`The server couldn't load this order (${res.status}). Try again in a moment.`);
    throw new Error(`Couldn't load this order (${res.status}).`);
  }, []);

  const createPO = useCallback(async (data: {
    storeLocationId: string;
    supplierId: string;
    lines: { ingredientId: string; orderedQty: string; orderedUnit: string; unitCost?: string }[];
    notes?: string;
    expectedDeliveryDate?: string;
  }) => {
    const res = await fetch(`${API}/purchase-orders`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create purchase order");
    }
    const created = await res.json();
    await refresh();
    return created as PurchaseOrder;
  }, [refresh]);

  const submitPO = useCallback(async (poId: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/submit`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to submit purchase order");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const cancelPO = useCallback(async (poId: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/cancel`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to cancel purchase order");
    }
    await refresh();
  }, [refresh]);

  const receiveLine = useCallback(async (
    poId: string,
    lineId: string,
    data: { receivedQty: string; receivedUnit: string; unitCost?: string | null },
  ) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/lines/${lineId}/receive`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to receive line");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const approvePO = useCallback(async (poId: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/approve`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to approve purchase order");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const rejectPO = useCallback(async (poId: string, reason: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/reject`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to reject purchase order");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const clonePO = useCallback(async (sourcePOId: string, storeLocationId: string) => {
    const res = await fetch(`${API}/purchase-orders/${sourcePOId}/clone`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ storeLocationId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to clone purchase order");
    }
    await refresh();
    return res.json() as Promise<PurchaseOrder & { skippedItems: string[] }>;
  }, [refresh]);

  const downloadPdf = useCallback(async (poId: string, poNumber?: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/pdf`, opts);
    if (!res.ok) throw new Error("Failed to download PDF");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${poNumber ?? `PO-${poId.slice(0, 8)}`}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const emailPOToSupplier = useCallback(async (poId: string) => {
    const res = await fetch(`${API}/purchase-orders/${poId}/send-email`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Couldn't email the supplier.");
    }
    await refresh();
    return res.json() as Promise<
      | { emailed: true; emailedAt: string; to: string }
      | { emailed: false; reason: "no_supplier_email" | "email_not_configured" | "not_email_supplier"; message: string }
    >;
  }, [refresh]);

  return {
    pos, isLoading, refresh, getDetail, createPO, submitPO, cancelPO,
    receiveLine, approvePO, rejectPO, clonePO, downloadPdf, emailPOToSupplier,
  };
}

// ─── useTransfers ──────────────────────────────────────────────

export function useTransfers(locationId: string | null) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState<Transfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const [allRes, pendingRes] = await Promise.all([
        fetch(`${API}/transfers?storeLocationId=${locationId}`, opts),
        fetch(`${API}/transfers/pending?storeLocationId=${locationId}`, opts),
      ]);
      if (allRes.ok) setTransfers(await allRes.json());
      if (pendingRes.ok) setPendingIncoming(await pendingRes.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  const initiate = useCallback(async (data: {
    fromLocationId: string;
    toLocationId: string;
    lines: { ingredientId: string; sentQty: number; sentUnit: string }[];
    notes?: string;
  }) => {
    const res = await fetch(`${API}/transfers`, {
      ...jsonOpts, method: "POST", body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to initiate transfer");
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const confirmSent = useCallback(async (transferId: string) => {
    const res = await fetch(`${API}/transfers/${transferId}/send`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = "Failed to confirm send";
      try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
      throw new Error(msg);
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const confirmReceived = useCallback(async (
    transferId: string,
    receivedLines: { lineId: string; receivedQty: number }[],
  ) => {
    const res = await fetch(`${API}/transfers/${transferId}/receive`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ receivedLines }),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = "Failed to confirm receipt";
      try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
      throw new Error(msg);
    }
    await refresh();
    return res.json();
  }, [refresh]);

  const cancel = useCallback(async (transferId: string) => {
    const res = await fetch(`${API}/transfers/${transferId}/cancel`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = "Failed to cancel transfer";
      try { msg = JSON.parse(text).error || msg; } catch { msg = text || msg; }
      throw new Error(msg);
    }
    await refresh();
  }, [refresh]);

  return { transfers, pendingIncoming, isLoading, initiate, confirmSent, confirmReceived, cancel, refresh };
}

// ─── useForecasts ──────────────────────────────────────────────

export function useForecasts(locationId: string | null) {
  const [recommendations, setRecommendations] = useState<ForecastRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!locationId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/forecasts?storeLocationId=${locationId}`, opts);
      if (res.ok) setRecommendations(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, [locationId]);

  useEffect(() => { refresh(); }, [refresh]);

  const generate = useCallback(async () => {
    if (!locationId) return;
    const res = await fetch(`${API}/forecasts/generate`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ storeLocationId: locationId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to generate forecasts");
    }
    const result = await res.json();
    await refresh();
    return result;
  }, [locationId, refresh]);

  const dismiss = useCallback(async (recId: string) => {
    const res = await fetch(`${API}/forecasts/${recId}/dismiss`, {
      ...jsonOpts, method: "POST",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to dismiss");
    }
    await refresh();
  }, [refresh]);

  const markOrdered = useCallback(async (recId: string, poId?: string) => {
    const res = await fetch(`${API}/forecasts/${recId}/ordered`, {
      ...jsonOpts, method: "POST", body: JSON.stringify({ poId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to mark ordered");
    }
    await refresh();
  }, [refresh]);

  return { recommendations, isLoading, generate, dismiss, markOrdered, refresh };
}
