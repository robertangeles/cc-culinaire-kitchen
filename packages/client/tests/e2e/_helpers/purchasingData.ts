import type { APIRequestContext } from "@playwright/test";
import { apiCall, type Defer } from "./data";
import { currentPrefix } from "./safety";

/**
 * Purchasing seeders for the purchasing and order-guide specs. Everything is
 * created through the real API under the run prefix, at the location the E2E
 * user has selected (the one the UI shows), and each row registers an undo.
 *
 * Cleanup facts that shape the undos:
 *  - Suppliers, order guides and ingredients are soft-deleted by the server, so
 *    deleting them always succeeds even when purchase orders reference them.
 *  - Purchase orders have no delete route. The undo cancels them; the prefixed
 *    CANCELLED rows are left for the server-side sweep script.
 *  - A SENT order may have been moved to RECEIVING by the "Receive Delivery"
 *    screen (it starts a receiving session on mount). RECEIVING cannot be
 *    cancelled, so the undo first resumes that session and cancels it, which
 *    returns the order to SENT.
 */

export interface SeededIngredient {
  id: string;
  name: string;
}

export interface SeededCatalog {
  /** Run prefix + tag + random suffix: unique per seeding call, since a crashed test restarts the worker and re-seeds under the same run id. */
  base: string;
  locationId: string;
  supplier: { id: string; name: string };
  ingredients: SeededIngredient[];
}

const API = "/api/inventory";

/** The location the logged-in user has selected: the one every page reads and writes. */
async function selectedLocationId(api: APIRequestContext): Promise<string> {
  const ctx = await apiCall<{ selectedLocationId: string | null }>(api, "GET", "/api/users/location-context");
  if (!ctx.selectedLocationId) throw new Error("E2E user has no selected location; seeding needs one");
  return ctx.selectedLocationId;
}

/** A supplier plus 3 costed ingredients linked to it, each with a par at the user's location (nothing on hand, so every line is below par). */
export async function seedCatalog(api: APIRequestContext, defer: Defer, tag: string): Promise<SeededCatalog> {
  const base = `${currentPrefix()}${tag}-${Math.random().toString(36).slice(2, 6)}`;
  const locationId = await selectedLocationId(api);

  const supplierName = `${base}-supplier`;
  const supplier = await apiCall<{ supplierId: string }>(api, "POST", `${API}/suppliers`, {
    supplierName,
    locationIds: [locationId],
  });
  defer(`supplier ${supplierName}`, async () => {
    await apiCall(api, "DELETE", `${API}/suppliers/${supplier.supplierId}`);
  });

  const ingredients: SeededIngredient[] = [];
  for (const letter of ["a", "b", "c"]) {
    const name = `${base}-ingredient-${letter}`;
    const ing = await apiCall<{ ingredientId: string }>(api, "POST", `${API}/ingredients`, {
      ingredientName: name,
      ingredientCategory: "produce",
      baseUnit: "kg",
      unitCost: "2.50",
    });
    defer(`ingredient ${name}`, async () => {
      await apiCall(api, "DELETE", `${API}/ingredients/${ing.ingredientId}`);
    });
    await apiCall(api, "POST", `${API}/ingredients/${ing.ingredientId}/suppliers`, {
      supplierId: supplier.supplierId,
      costPerUnit: "2.50",
      preferredInd: true,
    });
    await apiCall(api, "PATCH", `${API}/locations/${locationId}/ingredients/${ing.ingredientId}`, {
      parLevel: "20",
      reorderQty: "20",
    });
    ingredients.push({ id: ing.ingredientId, name });
  }

  return { base, locationId, supplier: { id: supplier.supplierId, name: supplierName }, ingredients };
}

/** A catalog plus an order guide over all 3 ingredients. The guide name is run-prefixed so specs can pick it out among other people's guides. */
export async function seedOrderGuide(api: APIRequestContext, defer: Defer) {
  const catalog = await seedCatalog(api, defer, "guide");
  const name = `${catalog.base}-guide`;
  const guide = await apiCall<{ orderGuideId: string }>(
    api,
    "POST",
    `${API}/locations/${catalog.locationId}/order-guides`,
    { supplierId: catalog.supplier.id, name },
  );
  defer(`order guide ${name}`, async () => {
    await apiCall(api, "DELETE", `${API}/order-guides/${guide.orderGuideId}`);
  });
  await apiCall(api, "PUT", `${API}/order-guides/${guide.orderGuideId}/items`, {
    items: catalog.ingredients.map((i, idx) => ({ ingredientId: i.id, sortOrder: idx })),
  });
  return { ...catalog, guide: { id: guide.orderGuideId, name } };
}

interface SeededPo {
  id: string;
  poNumber: string;
}

/**
 * One PO each in DRAFT, PENDING_APPROVAL and SENT (plus a second SENT), all from the same prefixed supplier.
 *
 * How each status is reached (no email is ever sent):
 *  - DRAFT: POST /purchase-orders.
 *  - SENT: POST /purchase-orders/:id/submit on a PO whose value is below the
 *    spend threshold. Submit flips straight to SENT; the supplier email is a
 *    separate explicit route that is never called, and the supplier has no
 *    ordering method, so the UI offers no email button either.
 *  - PENDING_APPROVAL: submit on a PO whose value is >= the effective spend
 *    threshold (location override, else org default). The PO line carries an
 *    explicit unitCost equal to the threshold so qty 1 always reaches it. If no
 *    threshold exists at all, a location override is set for the run and removed
 *    again in the undo.
 */
export async function seedPurchaseOrders(api: APIRequestContext, defer: Defer) {
  const catalog = await seedCatalog(api, defer, "po");
  const { locationId, supplier, ingredients } = catalog;

  const thresholds = await apiCall<{
    orgDefault: number | null;
    locationOverrides: Array<{ storeLocationId: string; thresholdAmount: number }>;
  }>(api, "GET", `${API}/thresholds`);
  let threshold =
    thresholds.locationOverrides.find((o) => o.storeLocationId === locationId)?.thresholdAmount ??
    thresholds.orgDefault;
  if (threshold === null) {
    threshold = 1000;
    await apiCall(api, "PUT", `${API}/thresholds/location`, { storeLocationId: locationId, amount: threshold });
    defer("spend threshold override", async () => {
      await apiCall(api, "DELETE", `${API}/thresholds/location/${locationId}`);
    });
  }

  const createPo = async (label: string, unitCost: string): Promise<SeededPo> => {
    const po = await apiCall<{ poId: string; poNumber: string }>(api, "POST", `${API}/purchase-orders`, {
      storeLocationId: locationId,
      supplierId: supplier.id,
      notes: `${catalog.base}-${label}`,
      lines: [{ ingredientId: ingredients[0].id, orderedQty: "1", orderedUnit: "kg", unitCost }],
    });
    defer(`PO ${po.poNumber} (${label})`, async () => {
      // A SENT order the receiving screen moved to RECEIVING must be returned to SENT before it can be cancelled.
      const current = await apiCall<{ status: string }>(api, "GET", `${API}/purchase-orders/${po.poId}`);
      if (current.status === "SENT" || current.status === "RECEIVING") {
        const started = await apiCall<{ session: { sessionId: string } }>(api, "POST", `${API}/receiving/sessions`, {
          poId: po.poId,
          storeLocationId: locationId,
        });
        await apiCall(api, "POST", `${API}/receiving/sessions/${started.session.sessionId}/cancel`);
      }
      await apiCall(api, "POST", `${API}/purchase-orders/${po.poId}/cancel`);
    });
    return { id: po.poId, poNumber: po.poNumber };
  };
  const submit = (po: SeededPo) => apiCall(api, "POST", `${API}/purchase-orders/${po.id}/submit`);

  const draft = await createPo("draft", "1");
  const pending = await createPo("pending", String(threshold));
  await submit(pending);
  const sent = await createPo("sent", "1");
  await submit(sent);
  // The receiving test moves its order to RECEIVING, so it gets its own SENT order.
  const sentToReceive = await createPo("sent-to-receive", "1");
  await submit(sentToReceive);

  return { ...catalog, pos: { draft, pending, sent, sentToReceive } };
}
