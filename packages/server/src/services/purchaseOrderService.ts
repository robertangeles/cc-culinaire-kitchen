/**
 * @module services/purchaseOrderService
 *
 * CRUD and workflow operations for Purchase Orders (Wave 3).
 * Handles PO lifecycle: DRAFT → SUBMITTED → PARTIALLY_RECEIVED / RECEIVED.
 * On receive, creates FIFO batches and updates stock levels.
 */

import { eq, and, desc, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  purchaseOrder,
  purchaseOrderLine,
  fifoBatch,
  stockLevel,
  ingredient,
  ingredientSupplier,
  supplier,
  storeLocation,
  user,
  locationIngredient,
} from "../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────

export interface CreatePOLineInput {
  ingredientId: string;
  orderedQty: string;
  orderedUnit: string;
  unitCost?: string;
}

export interface CreatePOInput {
  orgId: number;
  locationId: string;
  supplierId: string;
  userId: number;
  lines: CreatePOLineInput[];
  notes?: string;
  expectedDate?: string;
}

export interface ListPOOpts {
  status?: string;
  storeLocationId?: string;
  limit?: number;
  offset?: number;
}

// ─── createPO ─────────────────────────────────────────────────────

export async function createPO(input: CreatePOInput) {
  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;

  const [po] = await db
    .insert(purchaseOrder)
    .values({
      organisationId: input.orgId,
      storeLocationId: input.locationId,
      supplierId: input.supplierId,
      poNumber,
      status: "DRAFT",
      createdByUserId: input.userId,
      notes: input.notes ?? null,
      expectedDeliveryDate: input.expectedDate ? new Date(input.expectedDate) : null,
    })
    .returning();

  const lineRows = input.lines.map((l) => ({
    poId: po.poId,
    ingredientId: l.ingredientId,
    orderedQty: l.orderedQty,
    orderedUnit: l.orderedUnit,
    unitCost: l.unitCost ?? null,
    lineStatus: "PENDING",
  }));

  const insertedLines = await db
    .insert(purchaseOrderLine)
    .values(lineRows)
    .returning();

  return { ...po, lines: insertedLines };
}

// ─── listPOs ──────────────────────────────────────────────────────

export async function listPOs(orgId: number, opts: ListPOOpts = {}) {
  const conditions = [eq(purchaseOrder.organisationId, orgId)];

  if (opts.status) {
    conditions.push(eq(purchaseOrder.status, opts.status));
  }
  if (opts.storeLocationId) {
    conditions.push(eq(purchaseOrder.storeLocationId, opts.storeLocationId));
  }

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await db
    .select({
      poId: purchaseOrder.poId,
      poNumber: purchaseOrder.poNumber,
      status: purchaseOrder.status,
      notes: purchaseOrder.notes,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
      lineCount: sql<number>`(SELECT count(*) FROM purchase_order_line pol WHERE pol.po_id = ${purchaseOrder.poId})::int`,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(user, eq(purchaseOrder.createdByUserId, user.userId))
    .where(and(...conditions))
    .orderBy(desc(purchaseOrder.createdDttm))
    .limit(limit)
    .offset(offset);

  return rows;
}

// ─── getPODetail ──────────────────────────────────────────────────

export async function getPODetail(poId: string, orgId: number) {
  const [po] = await db
    .select({
      poId: purchaseOrder.poId,
      poNumber: purchaseOrder.poNumber,
      organisationId: purchaseOrder.organisationId,
      status: purchaseOrder.status,
      notes: purchaseOrder.notes,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
      createdDttm: purchaseOrder.createdDttm,
      updatedDttm: purchaseOrder.updatedDttm,
      storeLocationId: purchaseOrder.storeLocationId,
      supplierId: purchaseOrder.supplierId,
      createdByUserId: purchaseOrder.createdByUserId,
      supplierName: supplier.supplierName,
      locationName: storeLocation.locationName,
      createdByUserName: user.userName,
    })
    .from(purchaseOrder)
    .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
    .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
    .leftJoin(user, eq(purchaseOrder.createdByUserId, user.userId))
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) return null;

  const lines = await db
    .select({
      lineId: purchaseOrderLine.lineId,
      poId: purchaseOrderLine.poId,
      ingredientId: purchaseOrderLine.ingredientId,
      orderedQty: purchaseOrderLine.orderedQty,
      orderedUnit: purchaseOrderLine.orderedUnit,
      receivedQty: purchaseOrderLine.receivedQty,
      receivedUnit: purchaseOrderLine.receivedUnit,
      unitCost: purchaseOrderLine.unitCost,
      lineStatus: purchaseOrderLine.lineStatus,
      receivedByUserId: purchaseOrderLine.receivedByUserId,
      receivedDttm: purchaseOrderLine.receivedDttm,
      createdDttm: purchaseOrderLine.createdDttm,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      ingredientCategory: ingredient.ingredientCategory,
    })
    .from(purchaseOrderLine)
    .leftJoin(ingredient, eq(purchaseOrderLine.ingredientId, ingredient.ingredientId))
    .where(eq(purchaseOrderLine.poId, poId));

  return { ...po, lines };
}

// ─── submitPO ─────────────────────────────────────────────────────

export async function submitPO(poId: string, orgId: number, userId: number) {
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "DRAFT") throw new Error(`Cannot submit PO with status ${po.status}`);

  const [updated] = await db
    .update(purchaseOrder)
    .set({ status: "SUBMITTED", approvedByUserId: userId, updatedDttm: new Date() })
    .where(eq(purchaseOrder.poId, poId))
    .returning();

  return updated;
}

// ─── receiveLine ──────────────────────────────────────────────────

export async function receiveLine(
  poId: string,
  lineId: string,
  receivedQty: string,
  receivedUnit: string,
  unitCost: string | null,
  userId: number,
) {
  // Validate PO status
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.poId, poId));

  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "SUBMITTED" && po.status !== "PARTIALLY_RECEIVED") {
    throw new Error(`Cannot receive on PO with status ${po.status}`);
  }

  // Validate line belongs to PO
  const [line] = await db
    .select()
    .from(purchaseOrderLine)
    .where(and(eq(purchaseOrderLine.lineId, lineId), eq(purchaseOrderLine.poId, poId)));

  if (!line) throw new Error("PO line not found");
  if (line.lineStatus === "RECEIVED") throw new Error("Line already received");

  // Update the line
  const [updatedLine] = await db
    .update(purchaseOrderLine)
    .set({
      receivedQty,
      receivedUnit,
      unitCost: unitCost ?? line.unitCost,
      lineStatus: "RECEIVED",
      receivedByUserId: userId,
      receivedDttm: new Date(),
      updatedDttm: new Date(),
    })
    .where(eq(purchaseOrderLine.lineId, lineId))
    .returning();

  // Create FIFO batch
  await db.insert(fifoBatch).values({
    storeLocationId: po.storeLocationId,
    ingredientId: line.ingredientId,
    arrivalDate: new Date(),
    quantityRemaining: receivedQty,
    originalQuantity: receivedQty,
    unitCost: unitCost ?? line.unitCost,
    sourcePoLineId: lineId,
    isDepleted: false,
  });

  // Upsert stock level — add received qty
  const existingStock = await db
    .select()
    .from(stockLevel)
    .where(
      and(
        eq(stockLevel.storeLocationId, po.storeLocationId),
        eq(stockLevel.ingredientId, line.ingredientId),
      ),
    );

  if (existingStock.length > 0) {
    await db
      .update(stockLevel)
      .set({
        currentQty: sql`${stockLevel.currentQty}::numeric + ${receivedQty}::numeric`,
        updatedDttm: new Date(),
      })
      .where(eq(stockLevel.stockLevelId, existingStock[0].stockLevelId));
  } else {
    await db.insert(stockLevel).values({
      storeLocationId: po.storeLocationId,
      ingredientId: line.ingredientId,
      currentQty: receivedQty,
    });
  }

  // Check if all lines are received → update PO status
  const allLines = await db
    .select({ lineStatus: purchaseOrderLine.lineStatus })
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.poId, poId));

  const allReceived = allLines.every((l) => l.lineStatus === "RECEIVED");

  await db
    .update(purchaseOrder)
    .set({
      status: allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
      updatedDttm: new Date(),
    })
    .where(eq(purchaseOrder.poId, poId));

  return updatedLine;
}

// ─── cancelPO ─────────────────────────────────────────────────────

export async function cancelPO(poId: string, orgId: number, userId: number) {
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "DRAFT" && po.status !== "SUBMITTED") {
    throw new Error(`Cannot cancel PO with status ${po.status}`);
  }

  const [updated] = await db
    .update(purchaseOrder)
    .set({ status: "CANCELLED", updatedDttm: new Date() })
    .where(eq(purchaseOrder.poId, poId))
    .returning();

  return updated;
}

// ─── getSuggestions ───────────────────────────────────────────────

export async function getSuggestions(locationId: string, orgId: number) {
  // Find items where current stock < par level, grouped by preferred supplier
  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
      baseUnit: ingredient.baseUnit,
      parLevel: locationIngredient.parLevel,
      reorderQty: locationIngredient.reorderQty,
      currentQty: stockLevel.currentQty,
      supplierId: supplier.supplierId,
      supplierName: supplier.supplierName,
    })
    .from(locationIngredient)
    .innerJoin(ingredient, eq(locationIngredient.ingredientId, ingredient.ingredientId))
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.ingredientId, ingredient.ingredientId),
        eq(stockLevel.storeLocationId, locationId),
      ),
    )
    .leftJoin(supplier, eq(locationIngredient.supplierId, supplier.supplierId))
    .where(
      and(
        eq(locationIngredient.storeLocationId, locationId),
        eq(locationIngredient.activeInd, true),
        sql`COALESCE(${stockLevel.currentQty}::numeric, 0) < COALESCE(${locationIngredient.parLevel}::numeric, 0)`,
        sql`${locationIngredient.parLevel} IS NOT NULL AND ${locationIngredient.parLevel}::numeric > 0`,
      ),
    );

  // Group by supplier
  const grouped: Record<string, {
    supplierId: string | null;
    supplierName: string | null;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.supplierId ?? "unassigned";
    if (!grouped[key]) {
      grouped[key] = {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        items: [],
      };
    }
    grouped[key].items.push(row);
  }

  return Object.values(grouped);
}
