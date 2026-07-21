/**
 * @module services/orderGuideService
 *
 * Order guides are the PRIMARY purchase-ordering surface (Purchasing P1). A guide
 * is a reusable, per-supplier list an operator works from every week; the manual
 * catalog builder is the fallback. Lines reference `ingredient_id` only — cost,
 * pack size, and the supplier minimum are resolved LIVE from `ingredient_supplier`
 * / `ingredient` at render time (2NF: a guide never holds stale prices).
 *
 * `order_guide.store_location_id` is nullable: NULL = an org-wide guide, a value =
 * location-specific. P1 lists a location's guides plus any org-wide ones. Pricing
 * always resolves against the CURRENT location passed in by the caller.
 *
 * The suggested order quantity reuses `poMath.suggestedOrderQty` (the same rule the
 * Suggestions tab uses) so the guide and the auto-PO surface can never drift. The
 * ordering math reads ONLY `par_level`, never `suggested_par_level` (that column is
 * a P2 forecast PREVIEW the operator accepts into `par_level` first).
 */

import { eq, and, or, isNull, sql, asc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  orderGuide,
  orderGuideItem,
  ingredient,
  locationIngredient,
  ingredientSupplier,
  stockLevel,
  supplier,
  storeLocation,
} from "../db/schema.js";
import { suggestedOrderQty, toPurchasePackages, toPackCost } from "./poMath.js";
import type { OrderGuideItemView } from "@culinaire/shared";

export class OrderGuideError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "OrderGuideError";
  }
}

export interface GuideItemInput {
  ingredientId: string;
  /** Remembered default order qty in the item's purchase unit. Null = order-to-par decides. */
  defaultOrderQty?: number | null;
  defaultPurchaseUnit?: string | null;
  sortOrder?: number;
}

/** Assert the location belongs to the caller's org. Cross-org ids read as absent. */
async function assertLocationInOrg(locationId: string, orgId: number): Promise<void> {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(
      and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)),
    );
  if (!loc) throw new OrderGuideError("Location not found", 404);
}

/** Assert the supplier belongs to the caller's org. */
async function assertSupplierInOrg(supplierId: string, orgId: number): Promise<void> {
  const [sup] = await db
    .select({ id: supplier.supplierId })
    .from(supplier)
    .where(and(eq(supplier.supplierId, supplierId), eq(supplier.organisationId, orgId)));
  if (!sup) throw new OrderGuideError("Supplier not found", 404);
}

/** Load a guide, scoped to the caller's org. Cross-org id is a 404, not a 403. */
async function getGuideInOrg(guideId: string, orgId: number) {
  const [guide] = await db
    .select({
      orderGuideId: orderGuide.orderGuideId,
      storeLocationId: orderGuide.storeLocationId,
      supplierId: orderGuide.supplierId,
      name: orderGuide.name,
      activeInd: orderGuide.activeInd,
    })
    .from(orderGuide)
    .where(and(eq(orderGuide.orderGuideId, guideId), eq(orderGuide.organisationId, orgId)));
  if (!guide) throw new OrderGuideError("Order guide not found", 404);
  return guide;
}

/**
 * Guides available at a location: the location's own guides PLUS any org-wide
 * ones (NULL store_location_id). Each carries the supplier name and how many
 * items are on its sheet, in the operator's chosen order — this feeds the guide
 * pills at the top of the ordering screen.
 */
export async function listGuides(orgId: number, locationId: string, includeInactive = false) {
  await assertLocationInOrg(locationId, orgId);

  const where = and(
    eq(orderGuide.organisationId, orgId),
    or(eq(orderGuide.storeLocationId, locationId), isNull(orderGuide.storeLocationId)),
    includeInactive ? undefined : eq(orderGuide.activeInd, true),
  );

  return db
    .select({
      orderGuideId: orderGuide.orderGuideId,
      name: orderGuide.name,
      supplierId: orderGuide.supplierId,
      supplierName: supplier.supplierName,
      storeLocationId: orderGuide.storeLocationId,
      sortOrder: orderGuide.sortOrder,
      activeInd: orderGuide.activeInd,
      updatedDttm: orderGuide.updatedDttm,
      itemCount: sql<number>`count(${orderGuideItem.orderGuideItemId})::int`,
    })
    .from(orderGuide)
    .innerJoin(supplier, eq(supplier.supplierId, orderGuide.supplierId))
    .leftJoin(orderGuideItem, eq(orderGuideItem.orderGuideId, orderGuide.orderGuideId))
    .where(where)
    .groupBy(orderGuide.orderGuideId, supplier.supplierId)
    .orderBy(asc(orderGuide.sortOrder), asc(orderGuide.name));
}

export async function createGuide(
  orgId: number,
  userId: number,
  data: { supplierId: string; storeLocationId?: string | null; name: string },
) {
  if (data.storeLocationId) await assertLocationInOrg(data.storeLocationId, orgId);
  await assertSupplierInOrg(data.supplierId, orgId);
  const name = data.name.trim();
  if (!name) throw new OrderGuideError("Give the guide a name", 400);

  const [created] = await db
    .insert(orderGuide)
    .values({
      organisationId: orgId,
      storeLocationId: data.storeLocationId ?? null,
      supplierId: data.supplierId,
      name,
      createdByUserId: userId,
    })
    .returning();
  return created;
}

export async function updateGuide(
  guideId: string,
  orgId: number,
  data: { name?: string; activeInd?: boolean; sortOrder?: number },
) {
  await getGuideInOrg(guideId, orgId);
  const patch: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new OrderGuideError("Give the guide a name", 400);
    patch.name = name;
  }
  if (data.activeInd !== undefined) patch.activeInd = data.activeInd;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;

  // Mutation carries its own org scope (CLAUDE.md): a row whose org changed
  // between the SELECT and the UPDATE can never be written cross-tenant.
  const [updated] = await db
    .update(orderGuide)
    .set(patch)
    .where(and(eq(orderGuide.orderGuideId, guideId), eq(orderGuide.organisationId, orgId)))
    .returning();
  return updated;
}

/** Soft delete (deactivate). Past POs are unaffected; the guide drops out of the picker. */
export async function deleteGuide(guideId: string, orgId: number) {
  await getGuideInOrg(guideId, orgId);
  const [updated] = await db
    .update(orderGuide)
    .set({ activeInd: false, updatedDttm: new Date() })
    .where(and(eq(orderGuide.orderGuideId, guideId), eq(orderGuide.organisationId, orgId)))
    .returning();
  return updated;
}

/** Raw item rows for a guide (no pricing) — used after a wholesale save. */
export async function listGuideItemsRaw(guideId: string, orgId: number) {
  await getGuideInOrg(guideId, orgId);
  return db
    .select({
      ingredientId: orderGuideItem.ingredientId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      defaultOrderQty: orderGuideItem.defaultOrderQty,
      defaultPurchaseUnit: orderGuideItem.defaultPurchaseUnit,
      sortOrder: orderGuideItem.sortOrder,
    })
    .from(orderGuideItem)
    .innerJoin(ingredient, eq(ingredient.ingredientId, orderGuideItem.ingredientId))
    .where(eq(orderGuideItem.orderGuideId, guideId))
    .orderBy(asc(orderGuideItem.sortOrder), asc(ingredient.ingredientName));
}

/**
 * The guide's items, priced and par-filled against ONE location — the payload the
 * ordering screen renders. One query, never N+1. Folds in three plan decisions:
 *  - soft-delete guard: the inner join drops any item whose ingredient was
 *    soft-deleted, so a guide never renders a phantom/crashing line (T11);
 *  - cost unified on preferred_unit_cost → location → org (T10);
 *  - the real supplier minimum (`minimum_order_qty`) surfaced for validation (T7).
 * `suggestedOrderQty` reuses poMath so it matches the Suggestions tab exactly.
 */
export async function getGuideItems(
  guideId: string,
  orgId: number,
  locationId: string,
): Promise<OrderGuideItemView[]> {
  const guide = await getGuideInOrg(guideId, orgId);
  await assertLocationInOrg(locationId, orgId);

  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      purchaseUnit: ingredient.purchaseUnit,
      packQty: ingredient.packQty,
      defaultOrderQty: orderGuideItem.defaultOrderQty,
      defaultPurchaseUnit: orderGuideItem.defaultPurchaseUnit,
      sortOrder: orderGuideItem.sortOrder,
      onHand: stockLevel.currentQty,
      locParLevel: locationIngredient.parLevel,
      orgParLevel: ingredient.parLevel,
      suggestedParLevel: locationIngredient.suggestedParLevel,
      locReorderQty: locationIngredient.reorderQty,
      orgReorderQty: ingredient.reorderQty,
      preferredUnitCost: ingredient.preferredUnitCost,
      locUnitCost: locationIngredient.unitCost,
      orgUnitCost: ingredient.unitCost,
      supplierMinOrderQty: ingredientSupplier.minimumOrderQty,
    })
    .from(orderGuideItem)
    .innerJoin(
      ingredient,
      and(eq(ingredient.ingredientId, orderGuideItem.ingredientId), isNull(ingredient.deletedAt)),
    )
    .leftJoin(
      locationIngredient,
      and(
        eq(locationIngredient.ingredientId, orderGuideItem.ingredientId),
        eq(locationIngredient.storeLocationId, locationId),
      ),
    )
    .leftJoin(
      stockLevel,
      and(
        eq(stockLevel.ingredientId, orderGuideItem.ingredientId),
        eq(stockLevel.storeLocationId, locationId),
      ),
    )
    .leftJoin(
      ingredientSupplier,
      and(
        eq(ingredientSupplier.ingredientId, orderGuideItem.ingredientId),
        eq(ingredientSupplier.supplierId, guide.supplierId),
      ),
    )
    .where(eq(orderGuideItem.orderGuideId, guideId))
    .orderBy(asc(orderGuideItem.sortOrder), asc(ingredient.ingredientName));

  const num = (v: string | null) => (v != null ? Number(v) : null);

  return rows.map((r) => {
    const onHand = Number(r.onHand ?? 0);
    const parLevel = num(r.locParLevel) ?? num(r.orgParLevel);
    const reorderQty = num(r.locReorderQty) ?? num(r.orgReorderQty);
    const unitCost = num(r.preferredUnitCost) ?? num(r.locUnitCost) ?? num(r.orgUnitCost);
    const packQty = num(r.packQty);
    // Kitchen units — what the shortfall actually is (25 kg), for display.
    const shortfall = parLevel != null ? suggestedOrderQty(parLevel, onHand, reorderQty) : 0;
    return {
      ingredientId: r.ingredientId,
      ingredientName: r.ingredientName,
      baseUnit: r.baseUnit,
      purchaseUnit: r.purchaseUnit,
      packQty,
      onHand,
      parLevel,
      /** P2 preview only — the operator accepts this into parLevel; never drives ordering. */
      suggestedParLevel: num(r.suggestedParLevel),
      suggestedOrderQty: shortfall,
      /**
       * The same shortfall in the unit the PO is actually placed in. The form
       * labels the qty field with purchaseUnit, so it MUST fill it from this —
       * filling it from suggestedOrderQty orders packQty times too much.
       * Null when the item has no packaging (order in the kitchen unit).
       */
      suggestedPackages: toPurchasePackages(shortfall, packQty, r.purchaseUnit),
      belowPar: parLevel != null && onHand < parLevel,
      unitCost,
      /**
       * unitCost is per KITCHEN unit (schema: pack cost / pack_qty). A PO line
       * is priced per ORDERED unit — receiving divides it back down by the
       * conversion factor. Putting the per-kg cost on a per-bag line
       * understates the order AND then values received stock at cost/packQty.
       * Null when the item has no packaging.
       */
      packUnitCost: unitCost != null ? toPackCost(unitCost, packQty, r.purchaseUnit) : null,
      supplierMinOrderQty: num(r.supplierMinOrderQty),
      defaultOrderQty: num(r.defaultOrderQty),
      defaultPurchaseUnit: r.defaultPurchaseUnit,
      sortOrder: r.sortOrder,
    };
  });
}

/**
 * Replace a guide's items wholesale (the editor saves the full set), in one
 * transaction so a half-applied sheet is never observable. Mirrors
 * storageAreaService.setAreaItems.
 */
export async function setGuideItems(guideId: string, orgId: number, items: GuideItemInput[]) {
  await getGuideInOrg(guideId, orgId);

  const ids = items.map((i) => i.ingredientId);
  if (new Set(ids).size !== ids.length) {
    throw new OrderGuideError("An item can only appear once in a guide", 400);
  }

  // Every item must be a live (not soft-deleted) ingredient in the caller's org.
  if (ids.length > 0) {
    const owned = await db
      .select({ id: ingredient.ingredientId })
      .from(ingredient)
      .where(
        and(
          inArray(ingredient.ingredientId, ids),
          eq(ingredient.organisationId, orgId),
          isNull(ingredient.deletedAt),
        ),
      );
    if (owned.length !== ids.length) {
      throw new OrderGuideError("One or more items were not found", 404);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(orderGuideItem).where(eq(orderGuideItem.orderGuideId, guideId));
    if (items.length > 0) {
      await tx.insert(orderGuideItem).values(
        items.map((it, idx) => ({
          orderGuideId: guideId,
          ingredientId: it.ingredientId,
          defaultOrderQty: it.defaultOrderQty != null ? String(it.defaultOrderQty) : null,
          defaultPurchaseUnit: it.defaultPurchaseUnit ?? null,
          sortOrder: it.sortOrder ?? idx,
        })),
      );
    }
  });

  return listGuideItemsRaw(guideId, orgId);
}
