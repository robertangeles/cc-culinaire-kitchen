/**
 * @module services/ingredientStockService
 *
 * How an ingredient lives at locations — par levels, cost overrides,
 * activation state, stock movements, and transaction history.
 *
 * Responsible for: per-location ingredient config (get-or-create, list,
 * update), cross-location stock queries, bulk activation/deactivation,
 * copy-activation, activation status, and unified transaction history.
 *
 * {@link IngredientError} and catalog reads ({@link getIngredient}) are
 * imported from ingredientCatalogService — this file owns no catalog mutations.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient,
  locationIngredient,
  stockLevel,
  supplier,
  ingredientSupplier,
  storeLocation,
  consumptionLog,
  user,
} from "../db/schema.js";
import { IngredientError, getIngredient } from "./ingredientCatalogService.js";

// ─── Per-location ingredient config ───────────────────────────────

/** Get or create a location_ingredient record. */
export async function getOrCreateLocationIngredient(
  ingredientId: string,
  storeLocationId: string,
) {
  const existing = await db
    .select()
    .from(locationIngredient)
    .where(
      and(
        eq(locationIngredient.ingredientId, ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    );

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(locationIngredient)
    .values({ ingredientId, storeLocationId })
    .returning();
  return row;
}

/** List all ingredients for a location with their overrides. */
export async function listLocationIngredients(
  storeLocationId: string,
  organisationId: number,
  opts?: { itemType?: string; activeOnly?: boolean },
) {
  // Left join: all org ingredients + location overrides + stock + supplier
  const conditions = [eq(ingredient.organisationId, organisationId)];
  if (opts?.activeOnly !== false) {
    conditions.push(eq(locationIngredient.activeInd, true));
  }
  if (opts?.itemType) {
    conditions.push(eq(ingredient.itemType, opts.itemType));
  }

  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      itemType: ingredient.itemType,
      fifoApplicable: ingredient.fifoApplicable,
      // Kitchen unit — stock/counts/display all live in this unit; no lens.
      baseUnit: ingredient.baseUnit,
      // Content equivalence + purchase packaging (recipes / ordering surfaces).
      contentQty: ingredient.contentQty,
      contentUnit: ingredient.contentUnit,
      purchaseUnit: ingredient.purchaseUnit,
      packQty: ingredient.packQty,
      description: ingredient.description,
      orgUnitCost: ingredient.unitCost,
      orgParLevel: ingredient.parLevel,
      orgReorderQty: ingredient.reorderQty,
      // Allergens
      containsDairyInd: ingredient.containsDairyInd,
      containsGlutenInd: ingredient.containsGlutenInd,
      containsNutsInd: ingredient.containsNutsInd,
      containsShellfishInd: ingredient.containsShellfishInd,
      containsEggsInd: ingredient.containsEggsInd,
      isVegetarianInd: ingredient.isVegetarianInd,
      // Location overrides (nullable)
      locationIngredientId: locationIngredient.locationIngredientId,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
      locationUnitCost: locationIngredient.unitCost,
      unitOverride: locationIngredient.unitOverride,
      categoryOverride: locationIngredient.categoryOverride,
      activeInd: locationIngredient.activeInd,
      // Supplier
      supplierId: locationIngredient.supplierId,
      supplierName: supplier.supplierName,
      /**
       * The supplier's REAL minimum order quantity. Ordering surfaces used to
       * show location_ingredient.reorder_qty under a "Min Ord" heading, which
       * read as a supplier constraint and misled buyers — a PO could be sent
       * below an actual minimum with nothing flagging it.
       */
      supplierMinOrderQty: ingredientSupplier.minimumOrderQty,
      // Current stock
      currentQty: stockLevel.currentQty,
      lastCountedDttm: stockLevel.lastCountedDttm,
    })
    .from(ingredient)
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, ingredient.ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    )
    .leftJoin(
      supplier,
      eq(supplier.supplierId, locationIngredient.supplierId),
    )
    // Minimum for whichever supplier this location actually buys from — its own
    // choice, else the ingredient's preferred one (a location with no override
    // row still gets a meaningful minimum instead of null).
    .leftJoin(
      ingredientSupplier,
      and(
        eq(ingredientSupplier.ingredientId, ingredient.ingredientId),
        sql`${ingredientSupplier.supplierId} = COALESCE(${locationIngredient.supplierId}, ${ingredient.preferredSupplierId})`,
      ),
    )
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.ingredientId, ingredient.ingredientId),
        eq(stockLevel.storeLocationId, storeLocationId),
      ),
    )
    .where(and(...conditions));

  return rows;
}

/** Update location-specific ingredient config (par level, unit override, cost, supplier, etc.). */
export async function updateLocationIngredient(
  ingredientId: string,
  storeLocationId: string,
  organisationId: number,
  data: Partial<{
    parLevel: string;
    reorderQty: string;
    unitCost: string | null;
    supplierId: string | null;
    unitOverride: string | null;
    categoryOverride: string | null;
    activeInd: boolean;
  }>,
) {
  // Verify ingredient and location both belong to the org before writing
  const ing = await getIngredient(ingredientId, organisationId);
  if (!ing) return null;

  const [loc] = await db
    .select({ orgId: storeLocation.organisationId })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));
  if (!loc || loc.orgId !== organisationId) return null;

  // Ensure record exists first
  await getOrCreateLocationIngredient(ingredientId, storeLocationId);

  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.parLevel !== undefined) updates.parLevel = data.parLevel;
  if (data.reorderQty !== undefined) updates.reorderQty = data.reorderQty;
  if (data.unitCost !== undefined) updates.unitCost = data.unitCost;
  if (data.supplierId !== undefined) updates.supplierId = data.supplierId;
  if (data.unitOverride !== undefined) updates.unitOverride = data.unitOverride;
  if (data.categoryOverride !== undefined) updates.categoryOverride = data.categoryOverride;
  if (data.activeInd !== undefined) updates.activeInd = data.activeInd;

  const [row] = await db
    .update(locationIngredient)
    .set(updates)
    .where(
      and(
        eq(locationIngredient.ingredientId, ingredientId),
        eq(locationIngredient.storeLocationId, storeLocationId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─── Cross-location stock queries ────────────────────────────────

/** Get stock levels for a single ingredient across ALL locations in the org. */
export async function getIngredientStockAcrossLocations(
  ingredientId: string,
  organisationId: number,
) {
  return db
    .select({
      storeLocationId: storeLocation.storeLocationId,
      locationName: storeLocation.locationName,
      currentQty: stockLevel.currentQty,
      lastCountedDttm: stockLevel.lastCountedDttm,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
      unitCost: locationIngredient.unitCost,
    })
    .from(storeLocation)
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.storeLocationId, storeLocation.storeLocationId),
        eq(stockLevel.ingredientId, ingredientId),
      ),
    )
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.storeLocationId, storeLocation.storeLocationId),
        eq(locationIngredient.ingredientId, ingredientId),
      ),
    )
    .where(eq(storeLocation.organisationId, organisationId));
}

// ─── Wave 1: Bulk activation & location management ──────────────

/** Bulk-activate items at a location (upsert location_ingredient rows) */
export async function bulkActivateItems(
  storeLocationId: string,
  ingredientIds: string[],
  organisationId: number,
) {
  if (!ingredientIds.length) return { activated: 0 };

  // Validate all ingredients belong to this org
  const valid = await db
    .select({ ingredientId: ingredient.ingredientId })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.organisationId, organisationId),
        inArray(ingredient.ingredientId, ingredientIds),
      ),
    );

  const validIds = new Set(valid.map((r) => r.ingredientId));
  const invalidIds = ingredientIds.filter((id) => !validIds.has(id));
  if (invalidIds.length) {
    throw new IngredientError(`Ingredients not found in organisation: ${invalidIds.join(", ")}`, 404);
  }

  // Upsert location_ingredient rows — set active_ind = true
  const values = ingredientIds.map((id) => ({
    ingredientId: id,
    storeLocationId,
    activeInd: true,
    updatedDttm: new Date(),
  }));

  for (const val of values) {
    await db
      .insert(locationIngredient)
      .values(val)
      .onConflictDoUpdate({
        target: [locationIngredient.ingredientId, locationIngredient.storeLocationId],
        set: { activeInd: true, updatedDttm: new Date() },
      });
  }

  return { activated: ingredientIds.length };
}

/** Bulk-deactivate items at a location */
export async function bulkDeactivateItems(
  storeLocationId: string,
  ingredientIds: string[],
  organisationId: number,
) {
  if (!ingredientIds.length) return { deactivated: 0 };

  // Validate all ingredients belong to this org
  const valid = await db
    .select({ ingredientId: ingredient.ingredientId })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.organisationId, organisationId),
        inArray(ingredient.ingredientId, ingredientIds),
      ),
    );

  const validIds = new Set(valid.map((r) => r.ingredientId));
  const invalidIds = ingredientIds.filter((id) => !validIds.has(id));
  if (invalidIds.length) {
    throw new IngredientError(`Ingredients not found in organisation: ${invalidIds.join(", ")}`, 404);
  }

  await db
    .update(locationIngredient)
    .set({ activeInd: false, updatedDttm: new Date() })
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        inArray(locationIngredient.ingredientId, ingredientIds),
      ),
    );

  return { deactivated: ingredientIds.length };
}

/** Copy activation from one location to another (merge — don't overwrite existing) */
export async function copyActivationFromLocation(
  sourceLocationId: string,
  targetLocationId: string,
  organisationId: number,
) {
  // Get all active items at source
  const sourceItems = await db
    .select({
      ingredientId: locationIngredient.ingredientId,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
    })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(ingredient.ingredientId, locationIngredient.ingredientId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, sourceLocationId),
        eq(locationIngredient.activeInd, true),
        eq(ingredient.organisationId, organisationId),
      ),
    );

  if (!sourceItems.length) {
    throw new IngredientError("Source location has no activated items", 422);
  }

  let copied = 0;
  for (const item of sourceItems) {
    await db
      .insert(locationIngredient)
      .values({
        ingredientId: item.ingredientId,
        storeLocationId: targetLocationId,
        parLevel: item.parLevel,
        reorderQty: item.reorderQty,
        activeInd: true,
        updatedDttm: new Date(),
      })
      .onConflictDoUpdate({
        target: [locationIngredient.ingredientId, locationIngredient.storeLocationId],
        set: { activeInd: true, updatedDttm: new Date() },
      });
    copied++;
  }

  return { copied };
}

/** Get activation status for a location (counts by item type) */
export async function getActivationStatus(
  storeLocationId: string,
  organisationId: number,
) {
  const allItems = await db
    .select({
      ingredientId: ingredient.ingredientId,
      itemType: ingredient.itemType,
    })
    .from(ingredient)
    .where(eq(ingredient.organisationId, organisationId));

  const activeItems = await db
    .select({
      ingredientId: locationIngredient.ingredientId,
      itemType: ingredient.itemType,
    })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(ingredient.ingredientId, locationIngredient.ingredientId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, storeLocationId),
        eq(locationIngredient.activeInd, true),
        eq(ingredient.organisationId, organisationId),
      ),
    );

  const byType = { KITCHEN_INGREDIENT: 0, FOH_CONSUMABLE: 0, OPERATIONAL_SUPPLY: 0 };
  for (const item of activeItems) {
    if (item.itemType in byType) {
      byType[item.itemType as keyof typeof byType]++;
    }
  }

  return {
    total: allItems.length,
    activated: activeItems.length,
    byType,
  };
}

// ─── Transaction history ─────────────────────────────────────────

/** Get unified transaction history for an ingredient in a given month */
export async function getIngredientTransactions(
  ingredientId: string,
  organisationId: number,
  month: string, // "2026-04" format
) {
  // Parse month to UTC date range
  const startDate = `${month}-01T00:00:00.000Z`;
  const nextMonth = Number(month.split("-")[1]) === 12
    ? `${Number(month.split("-")[0]) + 1}-01`
    : `${month.split("-")[0]}-${String(Number(month.split("-")[1]) + 1).padStart(2, "0")}`;
  const endDate = `${nextMonth}-01T00:00:00.000Z`;

  // 1. Stock take lines for this ingredient in this month
  let stockTakeRows: any[] = [];
  try {
    const stResult = await db.execute(sql`
      SELECT stl.line_id as id, stl.counted_qty as quantity, stl.counted_unit as unit,
             stl.counted_dttm as "occurredAt", u.user_name as "userName"
      FROM stock_take_line stl
      INNER JOIN stock_take_category stc ON stc.category_id = stl.category_id
      INNER JOIN stock_take_session sts ON sts.session_id = stc.session_id
      INNER JOIN "user" u ON u.user_id = stl.counted_by_user_id
      WHERE stl.ingredient_id = ${ingredientId}
        AND sts.organisation_id = ${organisationId}
        AND stl.counted_dttm >= ${startDate}::timestamptz
        AND stl.counted_dttm < ${endDate}::timestamptz
    `);
    stockTakeRows = (stResult as any).rows ?? stResult ?? [];
  } catch { stockTakeRows = []; }

  // 2. Consumption log entries (using Drizzle ORM)
  let consumptionRows: { id: string; quantity: string; unit: string; reason: string; shift: string | null; occurredAt: Date; userName: string }[] = [];
  try {
    consumptionRows = await db
      .select({
        id: consumptionLog.consumptionLogId,
        quantity: consumptionLog.quantity,
        unit: consumptionLog.unit,
        reason: consumptionLog.reason,
        shift: consumptionLog.shift,
        occurredAt: consumptionLog.loggedAt,
        userName: user.userName,
      })
      .from(consumptionLog)
      .innerJoin(user, eq(user.userId, consumptionLog.userId))
      .where(
        and(
          eq(consumptionLog.ingredientId, ingredientId),
          eq(consumptionLog.organisationId, organisationId),
          sql`${consumptionLog.loggedAt} >= ${startDate}::timestamptz`,
          sql`${consumptionLog.loggedAt} < ${endDate}::timestamptz`,
        ),
      );
  } catch { consumptionRows = []; }

  // 3. Waste log entries — uses ingredient_name (text), not ingredient_id (FK)
  let wasteRows: any[] = [];
  try {
    const [ing] = await db
      .select({ name: ingredient.ingredientName })
      .from(ingredient)
      .where(eq(ingredient.ingredientId, ingredientId));

    if (ing) {
      const wResult = await db.execute(sql`
        SELECT waste_log_id as id, quantity, unit, reason,
               logged_at as "occurredAt", u.user_name as "userName"
        FROM waste_log wl
        INNER JOIN "user" u ON u.user_id = wl.user_id
        WHERE wl.ingredient_name = ${ing.name}
          AND wl.organisation_id = ${organisationId}
          AND wl.logged_at >= ${startDate}::timestamptz
          AND wl.logged_at < ${endDate}::timestamptz
      `);
      wasteRows = (wResult as any).rows ?? wResult ?? [];
    }
  } catch { wasteRows = []; }

  // 4. Inter-location transfers (sent or received for this ingredient)
  let transferRows: any[] = [];
  try {
    const trResult = await db.execute(sql`
      SELECT tl.line_id as id, tl.sent_qty as quantity, tl.sent_unit as unit,
             t.transfer_id as "transferId",
             t.status as reason, t.sent_dttm as "occurredAt",
             u.user_name as "userName",
             sl_from.location_name as "fromLocation",
             sl_to.location_name as "toLocation",
             t.from_location_id, t.to_location_id
      FROM inventory_transfer_line tl
      INNER JOIN inventory_transfer t ON t.transfer_id = tl.transfer_id
      INNER JOIN "user" u ON u.user_id = t.initiated_by_user_id
      INNER JOIN store_location sl_from ON sl_from.store_location_id = t.from_location_id
      INNER JOIN store_location sl_to ON sl_to.store_location_id = t.to_location_id
      WHERE tl.ingredient_id = ${ingredientId}
        AND t.organisation_id = ${organisationId}
        AND t.created_dttm >= ${startDate}::timestamptz
        AND t.created_dttm < ${endDate}::timestamptz
    `);
    transferRows = (trResult as any).rows ?? trResult ?? [];
  } catch { transferRows = []; }

  // 5. Area-to-area moves within one site (Stock Room → Bar).
  //    These have ZERO stock effect — the item never left the venue. They appear
  //    here so "where did my stock go?" has an honest answer: it didn't go
  //    anywhere, someone carried it to the bar.
  let movementRows: any[] = [];
  try {
    const mvResult = await db.execute(sql`
      SELECT sm.stock_movement_id as id, sm.quantity, sm.unit,
             sm.moved_at as "occurredAt", u.user_name as "userName",
             sa_from.area_name as "fromArea", sa_to.area_name as "toArea"
      FROM stock_movement sm
      INNER JOIN "user" u ON u.user_id = sm.user_id
      INNER JOIN storage_area sa_from ON sa_from.storage_area_id = sm.from_storage_area_id
      INNER JOIN storage_area sa_to ON sa_to.storage_area_id = sm.to_storage_area_id
      WHERE sm.ingredient_id = ${ingredientId}
        AND sm.organisation_id = ${organisationId}
        AND sm.moved_at >= ${startDate}::timestamptz
        AND sm.moved_at < ${endDate}::timestamptz
    `);
    movementRows = (mvResult as any).rows ?? mvResult ?? [];
  } catch { movementRows = []; }

  // 6. Deliveries received. Stock's single largest INBOUND movement, and it was
  // missing from this history entirely — a chef could receive 4 bags of flour,
  // watch stock on hand jump, then open this panel and see "No activity on this
  // day". Every other source here is a count, a usage, a loss, or a move; nothing
  // recorded the arrival.
  //
  // Sourced from purchase_order_line rather than receiving_line because that is
  // the row confirmReceipt stamps with received_qty / received_by_user_id /
  // received_dttm, and it survives the receiving session being cleaned up.
  // Quantity is reported in the ORDERED unit (e.g. "4 bag"), which is what the
  // kitchen actually took delivery of; the base-unit equivalent is already
  // visible in stock on hand.
  let receiptRows: any[] = [];
  try {
    const rcResult = await db.execute(sql`
      SELECT pol.line_id AS id,
             pol.received_qty AS quantity,
             COALESCE(pol.received_unit, pol.ordered_unit) AS unit,
             pol.line_status AS "lineStatus",
             po.po_id AS "poId",
             po.po_number AS "poNumber",
             s.supplier_name AS "supplierName",
             pol.received_dttm AS "occurredAt",
             u.user_name AS "userName"
        FROM purchase_order_line pol
        INNER JOIN purchase_order po ON po.po_id = pol.po_id
        LEFT JOIN supplier s ON s.supplier_id = po.supplier_id
        LEFT JOIN "user" u ON u.user_id = pol.received_by_user_id
       WHERE pol.ingredient_id = ${ingredientId}
         AND po.organisation_id = ${organisationId}
         AND pol.received_dttm IS NOT NULL
         AND pol.received_qty IS NOT NULL
         AND pol.received_dttm >= ${startDate}::timestamptz
         AND pol.received_dttm < ${endDate}::timestamptz
    `);
    receiptRows = (rcResult as any).rows ?? rcResult ?? [];
  } catch { receiptRows = []; }

  // Merge all into unified TransactionEvent[]
  const transactions = [
    ...stockTakeRows.map((r: any) => ({
      id: r.id,
      type: "stock_take" as const,
      link: null,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: null,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
    ...consumptionRows.map((r: any) => ({
      id: r.id,
      type: "transfer" as const,
      link: null,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: r.reason,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
    ...wasteRows.map((r: any) => ({
      id: r.id || r.waste_log_id,
      type: "waste" as const,
      link: null,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: r.reason,
      userName: r.user_name || r.userName || "Unknown",
      occurredAt: typeof r.occurred_at === "string" ? r.occurred_at : r.occurred_at?.toISOString?.() || "",
    })),
    ...transferRows.map((r: any) => ({
      id: r.id,
      type: "transfer_loc" as const,
      // Transfers are the only other event with a real record-level destination:
      // TransferList expands a specific transfer by id. Stock takes are HQ-gated
      // (linking a chef into a 403 is worse than not linking), and area moves /
      // usage have only entry forms, no browsable list to land on.
      link: r.transferId ? `/inventory?tab=log&view=transfers&transfer=${r.transferId}` : null,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: `${r.fromLocation} → ${r.toLocation}`,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt || r.created_dttm || ""),
    })),
    ...movementRows.map((r: any) => ({
      id: r.id,
      type: "movement" as const,
      link: null,
      quantity: String(r.quantity),
      unit: r.unit,
      // Mirrors how transfer_loc formats its detail line.
      reason: `${r.fromArea} → ${r.toArea}`,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
    ...receiptRows.map((r: any) => ({
      id: r.id,
      type: "receipt" as const,
      quantity: String(r.quantity),
      unit: r.unit,
      // Supplier + PO, so a chef can trace the number back to a delivery. A
      // short or rejected line says so — otherwise a partial delivery would be
      // indistinguishable from a full one.
      reason: [
        r.supplierName,
        r.poNumber,
        r.lineStatus && r.lineStatus !== "RECEIVED" ? String(r.lineStatus).toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(" · "),
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
      // Deep-link to the order this delivery came from. The other event types
      // have no destination yet — see the audit before wiring any more.
      link: r.poId ? `/purchasing?tab=orders&po=${r.poId}` : null,
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  // Extract unique dates for calendar dots
  const transactionDates = [...new Set(
    transactions.map((t) => t.occurredAt.slice(0, 10)),
  )];

  return { transactions, transactionDates };
}
