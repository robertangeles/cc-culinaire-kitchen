/**
 * @module services/ingredientCatalogService
 *
 * What an ingredient IS — the org-wide catalog, supplier registry, unit
 * conversions, and supplier-to-ingredient assignments.
 *
 * Responsible for: ingredient CRUD (create / list / get / update / soft-delete /
 * restore), kitchen-unit changes, unit conversions, supplier CRUD,
 * supplier-location assignments, and ingredient-supplier link management.
 *
 * **Hard delete is BANNED on the catalog `ingredient` table.** Use
 * {@link softDeleteIngredient}. Hard-deleting a row would silently sever the
 * FK lineage from menu_item_ingredient + recipe.recipeData and erase allergen
 * data from every dish that referenced it. The soft-delete pattern hides the
 * row from picker results while preserving cost + allergen reads on
 * already-linked dishes. This rule is enforced by code review and the absence
 * of any `deleteIngredient` export here — do NOT add one.
 */

import { eq, and, ilike, sql, count, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient,
  unitConversion,
  supplier,
  supplierLocation,
  storeLocation,
  ingredientSupplier,
  menuItemIngredient,
  menuItem,
} from "../db/schema.js";
import * as auditService from "./auditService.js";
import { invalidateConversionCache } from "./unitConversionService.js";

export class IngredientError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = "IngredientError";
  }
}

// ─── Org-wide ingredient catalog ──────────────────────────────────

/**
 * Create a new ingredient in the org catalog.
 *
 * Kitchen-unit model: `baseUnit` is THE unit the item is counted/stocked in
 * (flour g, wine bottle). `contentQty`/`contentUnit` optionally state what one
 * kitchen unit contains (1 bottle = 750 ml) so recipes can use measured units.
 * `purchaseUnit` + `packQty` describe the primary purchase packaging
 * (case of 12 bottles) used only at ordering/receiving.
 */
export async function createIngredient(
  organisationId: number,
  data: {
    ingredientName: string;
    ingredientCategory: string;
    baseUnit: string;
    contentQty?: string | null;
    contentUnit?: string | null;
    densityGPerMl?: string | null;
    purchaseUnit?: string | null;
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
  },
) {
  const [row] = await db
    .insert(ingredient)
    .values({
      organisationId,
      ingredientName: data.ingredientName.trim(),
      ingredientCategory: data.ingredientCategory,
      baseUnit: data.baseUnit,
      contentQty: data.contentQty ?? null,
      contentUnit: data.contentUnit ?? null,
      densityGPerMl: data.densityGPerMl ?? null,
      purchaseUnit: data.purchaseUnit ?? null,
      packQty: data.packQty ?? null,
      description: data.description ?? null,
      unitCost: data.unitCost ?? null,
      parLevel: data.parLevel ?? null,
      reorderQty: data.reorderQty ?? null,
      containsDairyInd: data.containsDairyInd ?? false,
      containsGlutenInd: data.containsGlutenInd ?? false,
      containsNutsInd: data.containsNutsInd ?? false,
      containsShellfishInd: data.containsShellfishInd ?? false,
      containsEggsInd: data.containsEggsInd ?? false,
      isVegetarianInd: data.isVegetarianInd ?? false,
    })
    .returning();
  invalidateConversionCache(row.ingredientId);
  return row;
}

/**
 * Change an item's KITCHEN unit, converting everything stored in it — atomically.
 *
 * `factor` = old kitchen units per ONE new kitchen unit (ml → bottle: 750).
 * Quantities divide by factor (6000 ml → 8 bottles); per-unit costs multiply
 * ($0.02/ml → $15/bottle). Converts: stock_level.current_qty, ingredient
 * par/reorder/unit_cost, location_ingredient par/reorder/unit_cost/WAC,
 * fifo_batch quantities + unit_cost, and ingredient_supplier unit costs (the
 * preferred-cost trigger then refreshes ingredient.preferred_unit_cost).
 *
 * Recipe lines (menu_item_ingredient) are NOT touched: they carry their own
 * unit (e.g. "150 ml") and resolve through the content equivalence at
 * depletion/cost time — set contentQty/contentUnit alongside this call.
 */
export async function changeKitchenUnit(
  ingredientId: string,
  organisationId: number,
  newUnit: string,
  factor: number,
): Promise<void> {
  if (!(factor > 0)) throw new IngredientError("factor must be > 0", 400);
  await db.transaction(async (tx) => {
    const [ing] = await tx
      .select()
      .from(ingredient)
      .where(and(eq(ingredient.ingredientId, ingredientId), eq(ingredient.organisationId, organisationId)));
    if (!ing) throw new IngredientError("Ingredient not found in this organisation", 404);

    const f = String(factor);
    await tx.execute(sql`
      UPDATE stock_level SET current_qty = (current_qty::numeric / ${f}::numeric), updated_dttm = now()
      WHERE ingredient_id = ${ingredientId}::uuid`);
    await tx.execute(sql`
      UPDATE fifo_batch SET quantity_remaining = (quantity_remaining::numeric / ${f}::numeric),
        original_quantity = (original_quantity::numeric / ${f}::numeric),
        unit_cost = (unit_cost::numeric * ${f}::numeric)
      WHERE ingredient_id = ${ingredientId}::uuid`);
    await tx.execute(sql`
      UPDATE location_ingredient SET
        par_level = (par_level::numeric / ${f}::numeric),
        reorder_qty = (reorder_qty::numeric / ${f}::numeric),
        unit_cost = (unit_cost::numeric * ${f}::numeric),
        weighted_average_cost = (weighted_average_cost::numeric * ${f}::numeric),
        updated_dttm = now()
      WHERE ingredient_id = ${ingredientId}::uuid`);
    // cost_per_unit is per kitchen unit → converts; pack_cost is per package
    // (a case costs the same regardless of the kitchen unit) → untouched.
    await tx.execute(sql`
      UPDATE ingredient_supplier SET cost_per_unit = (cost_per_unit::numeric * ${f}::numeric)
      WHERE ingredient_id = ${ingredientId}::uuid`);
    await tx.execute(sql`
      UPDATE ingredient SET base_unit = ${newUnit},
        par_level = (par_level::numeric / ${f}::numeric),
        reorder_qty = (reorder_qty::numeric / ${f}::numeric),
        unit_cost = (unit_cost::numeric * ${f}::numeric),
        updated_dttm = now()
      WHERE ingredient_id = ${ingredientId}::uuid`);
  });
  invalidateConversionCache(ingredientId);
}

/**
 * List all ingredients for an organisation, optionally filtered by category.
 *
 * Soft-deleted rows are excluded by default. Pass `includeSoftDeleted: true`
 * for admin views that need to surface soft-deleted entries (e.g. an "all
 * ingredients" report or restoration UI).
 */
export function listIngredients(
  organisationId: number,
  opts?: { category?: string; search?: string; itemType?: string; includeSoftDeleted?: boolean },
) {
  // Build one AND of every predicate and apply it in a single .where().
  // Chaining .where() on a $dynamic() query REPLACES the prior clause rather
  // than ANDing it — that footgun previously let isNull(deletedAt) overwrite
  // the org filter, leaking every tenant's catalog on the default list.
  const conds = [eq(ingredient.organisationId, organisationId)];
  if (!opts?.includeSoftDeleted) conds.push(isNull(ingredient.deletedAt));
  if (opts?.category) conds.push(eq(ingredient.ingredientCategory, opts.category));
  if (opts?.search) conds.push(ilike(ingredient.ingredientName, `%${opts.search}%`));
  if (opts?.itemType) conds.push(eq(ingredient.itemType, opts.itemType));

  return db.select().from(ingredient).where(and(...conds));
}

/**
 * Get a single ingredient by ID (with org guard).
 *
 * Returns soft-deleted rows so menu_item_ingredient FK reads still resolve
 * the canonical row for cost/allergen lookup. Callers that present picker
 * results should filter via {@link listIngredients} instead.
 */
export async function getIngredient(ingredientId: string, organisationId: number) {
  const rows = await db
    .select()
    .from(ingredient)
    .where(
      and(
        eq(ingredient.ingredientId, ingredientId),
        eq(ingredient.organisationId, organisationId),
      ),
    );
  return rows[0] ?? null;
}

/**
 * Soft-delete an ingredient. Sets deleted_at + deleted_by; the row stays in
 * the table so menu_item_ingredient FK lineage and allergen reads continue
 * to resolve. Picker queries skip soft-deleted rows by default.
 *
 * Audit row written under the same transaction so the trail commits with
 * the soft-delete itself.
 *
 * Throws if the ingredient is not found in this org or is already deleted.
 *
 * **There is no hard-delete counterpart.** See module docstring.
 */
export async function getIngredientUsage(ingredientId: string) {
  return db
    .select({
      menuItemId: menuItemIngredient.menuItemId,
      menuItemName: menuItem.name,
    })
    .from(menuItemIngredient)
    .innerJoin(menuItem, eq(menuItem.menuItemId, menuItemIngredient.menuItemId))
    .where(eq(menuItemIngredient.ingredientId, ingredientId));
}

/** Soft-deletes an ingredient by marking it inactive; preserves transaction history. */
export async function softDeleteIngredient(
  ingredientId: string,
  organisationId: number,
  actorUserId: number,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ingredient)
      .where(
        and(
          eq(ingredient.ingredientId, ingredientId),
          eq(ingredient.organisationId, organisationId),
        ),
      );

    if (!existing) {
      throw new IngredientError("Ingredient not found in this organisation", 404);
    }
    if (existing.deletedAt) {
      throw new IngredientError("Ingredient is already soft-deleted", 409);
    }

    const now = new Date();
    const [updated] = await tx
      .update(ingredient)
      .set({ deletedAt: now, deletedBy: actorUserId, updatedDttm: now })
      .where(eq(ingredient.ingredientId, ingredientId))
      .returning();

    await auditService.log(
      {
        entityType: "ingredient",
        entityId: ingredientId,
        action: "soft_delete",
        actorUserId,
        organisationId,
        beforeValue: { deletedAt: null, deletedBy: null },
        afterValue: { deletedAt: now.toISOString(), deletedBy: actorUserId },
        metadata: { ingredientName: existing.ingredientName, ingredientCategory: existing.ingredientCategory },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Restore a previously soft-deleted ingredient. Clears deleted_at + deleted_by
 * and writes a `restore` audit row.
 */
export async function restoreIngredient(
  ingredientId: string,
  organisationId: number,
  actorUserId: number,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ingredient)
      .where(
        and(
          eq(ingredient.ingredientId, ingredientId),
          eq(ingredient.organisationId, organisationId),
        ),
      );

    if (!existing) {
      throw new IngredientError("Ingredient not found in this organisation", 404);
    }
    if (!existing.deletedAt) {
      throw new IngredientError("Ingredient is not soft-deleted", 409);
    }

    const [updated] = await tx
      .update(ingredient)
      .set({ deletedAt: null, deletedBy: null, updatedDttm: new Date() })
      .where(eq(ingredient.ingredientId, ingredientId))
      .returning();

    await auditService.log(
      {
        entityType: "ingredient",
        entityId: ingredientId,
        action: "restore",
        actorUserId,
        organisationId,
        beforeValue: { deletedAt: existing.deletedAt, deletedBy: existing.deletedBy },
        afterValue: { deletedAt: null, deletedBy: null },
        metadata: { ingredientName: existing.ingredientName },
      },
      tx,
    );

    return updated;
  });
}

/** Update an ingredient's fields. */
export async function updateIngredient(
  ingredientId: string,
  organisationId: number,
  data: Partial<{
    ingredientName: string;
    ingredientCategory: string;
    /**
     * NOTE: the kitchen unit. Editing it here does NOT convert existing stock —
     * use changeKitchenUnit for a unit flip on an item that already has stock.
     */
    baseUnit: string;
    contentQty: string | null;
    contentUnit: string | null;
    densityGPerMl: string | null;
    purchaseUnit: string | null;
    packQty: string | null;
    description: string | null;
    unitCost: string | null;
    parLevel: string | null;
    reorderQty: string | null;
    itemType: string;
    fifoApplicable: string;
    containsDairyInd: boolean;
    containsGlutenInd: boolean;
    containsNutsInd: boolean;
    containsShellfishInd: boolean;
    containsEggsInd: boolean;
    isVegetarianInd: boolean;
  }>,
) {
  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.ingredientName !== undefined) updates.ingredientName = data.ingredientName.trim();
  if (data.ingredientCategory !== undefined) updates.ingredientCategory = data.ingredientCategory;
  if (data.baseUnit !== undefined) updates.baseUnit = data.baseUnit;
  if (data.contentQty !== undefined) updates.contentQty = data.contentQty;
  if (data.contentUnit !== undefined) updates.contentUnit = data.contentUnit;
  if (data.densityGPerMl !== undefined) updates.densityGPerMl = data.densityGPerMl;
  if (data.purchaseUnit !== undefined) updates.purchaseUnit = data.purchaseUnit;
  if (data.packQty !== undefined) updates.packQty = data.packQty;
  if (data.itemType !== undefined) updates.itemType = data.itemType;
  if (data.fifoApplicable !== undefined) updates.fifoApplicable = data.fifoApplicable;
  if (data.description !== undefined) updates.description = data.description;
  if (data.unitCost !== undefined) updates.unitCost = data.unitCost;
  if (data.parLevel !== undefined) updates.parLevel = data.parLevel;
  if (data.reorderQty !== undefined) updates.reorderQty = data.reorderQty;
  if (data.containsDairyInd !== undefined) updates.containsDairyInd = data.containsDairyInd;
  if (data.containsGlutenInd !== undefined) updates.containsGlutenInd = data.containsGlutenInd;
  if (data.containsNutsInd !== undefined) updates.containsNutsInd = data.containsNutsInd;
  if (data.containsShellfishInd !== undefined) updates.containsShellfishInd = data.containsShellfishInd;
  if (data.containsEggsInd !== undefined) updates.containsEggsInd = data.containsEggsInd;
  if (data.isVegetarianInd !== undefined) updates.isVegetarianInd = data.isVegetarianInd;

  const [row] = await db
    .update(ingredient)
    .set(updates)
    .where(
      and(
        eq(ingredient.ingredientId, ingredientId),
        eq(ingredient.organisationId, organisationId),
      ),
    )
    .returning();
  if (!row) return null;
  // Unit facts may have changed (packaging/content) — drop the resolver cache.
  invalidateConversionCache(row.ingredientId);
  return row;
}

// ─── Unit conversions ─────────────────────────────────────────────

/** Add a unit conversion for an ingredient (e.g., 1 case = 12 each). */
export async function addUnitConversion(
  ingredientId: string,
  fromUnit: string,
  toBaseFactor: string,
) {
  const [row] = await db
    .insert(unitConversion)
    .values({ ingredientId, fromUnit, toBaseFactor })
    .returning();
  return row;
}

/** List all unit conversions for an ingredient. */
export async function listUnitConversions(ingredientId: string) {
  return db
    .select()
    .from(unitConversion)
    .where(eq(unitConversion.ingredientId, ingredientId));
}

/** Delete a unit conversion — scoped to the owning ingredient so a caller cannot delete another ingredient's conversion. */
export async function deleteUnitConversion(conversionId: string, ingredientId: string) {
  const [row] = await db
    .delete(unitConversion)
    .where(and(eq(unitConversion.conversionId, conversionId), eq(unitConversion.ingredientId, ingredientId)))
    .returning();
  return row ?? null;
}

// ─── Supplier CRUD ───────────────────────────────────────────────

/** Create a new supplier for the org. */
export async function createSupplier(
  organisationId: number,
  data: {
    supplierName: string;
    supplierCategory?: string;
    paymentTerms?: string;
    orderingMethod?: string;
    deliveryDays?: string;
    currency?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    website?: string;
    addressLine1?: string;
    addressLine2?: string;
    suburb?: string;
    state?: string;
    country?: string;
    postcode?: string;
    leadTimeDays?: number;
    minimumOrderValue?: string;
    notes?: string;
  },
) {
  const [row] = await db
    .insert(supplier)
    .values({
      organisationId,
      supplierName: data.supplierName.trim(),
      supplierCategory: data.supplierCategory ?? null,
      paymentTerms: data.paymentTerms ?? null,
      orderingMethod: data.orderingMethod ?? null,
      deliveryDays: data.deliveryDays ?? null,
      currency: data.currency ?? "AUD",
      contactName: data.contactName ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      website: data.website ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      suburb: data.suburb ?? null,
      state: data.state ?? null,
      country: data.country ?? null,
      postcode: data.postcode ?? null,
      leadTimeDays: data.leadTimeDays ?? null,
      minimumOrderValue: data.minimumOrderValue ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  return row;
}

/** List all active suppliers for an org. */
export async function listSuppliers(organisationId: number) {
  return db
    .select()
    .from(supplier)
    .where(
      and(
        eq(supplier.organisationId, organisationId),
        eq(supplier.activeInd, true),
      ),
    );
}

/** Update a supplier. */
export async function updateSupplier(
  supplierId: string,
  organisationId: number,
  data: Partial<{
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
  }>,
) {
  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.supplierName !== undefined) updates.supplierName = data.supplierName.trim();
  if (data.supplierCategory !== undefined) updates.supplierCategory = data.supplierCategory;
  if (data.paymentTerms !== undefined) updates.paymentTerms = data.paymentTerms;
  if (data.orderingMethod !== undefined) updates.orderingMethod = data.orderingMethod;
  if (data.deliveryDays !== undefined) updates.deliveryDays = data.deliveryDays;
  if (data.currency !== undefined) updates.currency = data.currency;
  if (data.contactName !== undefined) updates.contactName = data.contactName;
  if (data.contactEmail !== undefined) updates.contactEmail = data.contactEmail;
  if (data.contactPhone !== undefined) updates.contactPhone = data.contactPhone;
  if (data.website !== undefined) updates.website = data.website;
  if (data.addressLine1 !== undefined) updates.addressLine1 = data.addressLine1;
  if (data.addressLine2 !== undefined) updates.addressLine2 = data.addressLine2;
  if (data.suburb !== undefined) updates.suburb = data.suburb;
  if (data.state !== undefined) updates.state = data.state;
  if (data.country !== undefined) updates.country = data.country;
  if (data.postcode !== undefined) updates.postcode = data.postcode;
  if (data.leadTimeDays !== undefined) updates.leadTimeDays = data.leadTimeDays;
  if (data.minimumOrderValue !== undefined) updates.minimumOrderValue = data.minimumOrderValue;
  if (data.notes !== undefined) updates.notes = data.notes;

  const [row] = await db
    .update(supplier)
    .set(updates)
    .where(
      and(
        eq(supplier.supplierId, supplierId),
        eq(supplier.organisationId, organisationId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Soft-delete a supplier (set activeInd = false). */
export async function deleteSupplier(supplierId: string, organisationId: number) {
  const [row] = await db
    .update(supplier)
    .set({ activeInd: false, updatedDttm: new Date() })
    .where(
      and(
        eq(supplier.supplierId, supplierId),
        eq(supplier.organisationId, organisationId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Fetch a supplier only if it belongs to the org. Null otherwise. */
export async function getSupplierInOrg(supplierId: string, organisationId: number) {
  const rows = await db
    .select({ supplierId: supplier.supplierId })
    .from(supplier)
    .where(and(eq(supplier.supplierId, supplierId), eq(supplier.organisationId, organisationId)));
  return rows[0] ?? null;
}

// ─── Supplier-Location assignments ───────────────────────────────

/** Get which locations a supplier serves. */
export async function getSupplierLocations(supplierId: string) {
  return db
    .select({
      supplierLocationId: supplierLocation.supplierLocationId,
      storeLocationId: supplierLocation.storeLocationId,
      locationName: storeLocation.locationName,
      activeInd: supplierLocation.activeInd,
    })
    .from(supplierLocation)
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, supplierLocation.storeLocationId))
    .where(eq(supplierLocation.supplierId, supplierId));
}

/** Set which locations a supplier serves (replace all). */
export async function setSupplierLocations(
  supplierId: string,
  locationIds: string[],
  organisationId: number,
) {
  // Verify all locationIds belong to the org before (de)activating links
  if (locationIds.length > 0) {
    const valid = await db
      .select({ storeLocationId: storeLocation.storeLocationId })
      .from(storeLocation)
      .where(
        and(
          eq(storeLocation.organisationId, organisationId),
          inArray(storeLocation.storeLocationId, locationIds),
        ),
      );
    if (valid.length !== locationIds.length) {
      throw new IngredientError("One or more location IDs do not belong to your organisation", 400);
    }
  }

  // Deactivate all existing
  await db
    .update(supplierLocation)
    .set({ activeInd: false })
    .where(eq(supplierLocation.supplierId, supplierId));

  // Insert/reactivate selected
  for (const locId of locationIds) {
    const existing = await db
      .select()
      .from(supplierLocation)
      .where(
        and(
          eq(supplierLocation.supplierId, supplierId),
          eq(supplierLocation.storeLocationId, locId),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(supplierLocation)
        .set({ activeInd: true })
        .where(eq(supplierLocation.supplierLocationId, existing[0].supplierLocationId));
    } else {
      await db
        .insert(supplierLocation)
        .values({ supplierId, storeLocationId: locId });
    }
  }
}

// ─── Ingredient-Supplier assignments ─────────────────────────────

/** Assign a supplier to an ingredient with cost/SKU. */
export async function assignSupplierToIngredient(
  ingredientId: string,
  supplierId: string,
  data: {
    packCost?: string;
    costPerUnit?: string;
    supplierItemCode?: string;
    leadTimeDays?: number;
    minimumOrderQty?: string;
    preferredInd?: boolean;
  },
) {
  // If marking as preferred, unset any existing preferred for this ingredient
  if (data.preferredInd) {
    await db
      .update(ingredientSupplier)
      .set({ preferredInd: false, updatedDttm: new Date() })
      .where(
        and(
          eq(ingredientSupplier.ingredientId, ingredientId),
          eq(ingredientSupplier.preferredInd, true),
        ),
      );
  }

  const [row] = await db
    .insert(ingredientSupplier)
    .values({
      ingredientId,
      supplierId,
      packCost: data.packCost ?? null,
      costPerUnit: data.costPerUnit ?? null,
      supplierItemCode: data.supplierItemCode ?? null,
      leadTimeDays: data.leadTimeDays ?? null,
      minimumOrderQty: data.minimumOrderQty ?? null,
      preferredInd: data.preferredInd ?? false,
    })
    .returning();
  return row;
}

/** List all suppliers for an ingredient with cost/SKU info. */
export async function listIngredientSuppliers(ingredientId: string) {
  return db
    .select({
      ingredientSupplierId: ingredientSupplier.ingredientSupplierId,
      supplierId: ingredientSupplier.supplierId,
      supplierName: supplier.supplierName,
      contactName: supplier.contactName,
      packCost: ingredientSupplier.packCost,
      costPerUnit: ingredientSupplier.costPerUnit,
      supplierItemCode: ingredientSupplier.supplierItemCode,
      leadTimeDays: ingredientSupplier.leadTimeDays,
      minimumOrderQty: ingredientSupplier.minimumOrderQty,
      preferredInd: ingredientSupplier.preferredInd,
      activeInd: ingredientSupplier.activeInd,
    })
    .from(ingredientSupplier)
    .innerJoin(supplier, eq(supplier.supplierId, ingredientSupplier.supplierId))
    .where(
      and(
        eq(ingredientSupplier.ingredientId, ingredientId),
        eq(ingredientSupplier.activeInd, true),
      ),
    );
}

/**
 * Get all ingredient IDs linked to a specific supplier.
 * Used by the PO form to filter the item picker by selected supplier.
 */
export async function listSupplierIngredientIds(supplierId: string): Promise<string[]> {
  const rows = await db
    .select({ ingredientId: ingredientSupplier.ingredientId })
    .from(ingredientSupplier)
    .where(
      and(
        eq(ingredientSupplier.supplierId, supplierId),
        eq(ingredientSupplier.activeInd, true),
      ),
    );
  return rows.map((r) => r.ingredientId);
}

/** Update a supplier-ingredient assignment (cost, SKU, preferred). */
export async function updateIngredientSupplier(
  ingredientId: string,
  supplierId: string,
  data: Partial<{
    costPerUnit: string | null;
    supplierItemCode: string | null;
    leadTimeDays: number | null;
    minimumOrderQty: string | null;
    preferredInd: boolean;
  }>,
) {
  // If marking as preferred, unset others
  if (data.preferredInd) {
    await db
      .update(ingredientSupplier)
      .set({ preferredInd: false, updatedDttm: new Date() })
      .where(
        and(
          eq(ingredientSupplier.ingredientId, ingredientId),
          eq(ingredientSupplier.preferredInd, true),
        ),
      );
  }

  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.costPerUnit !== undefined) updates.costPerUnit = data.costPerUnit;
  if (data.supplierItemCode !== undefined) updates.supplierItemCode = data.supplierItemCode;
  if (data.leadTimeDays !== undefined) updates.leadTimeDays = data.leadTimeDays;
  if (data.minimumOrderQty !== undefined) updates.minimumOrderQty = data.minimumOrderQty;
  if (data.preferredInd !== undefined) updates.preferredInd = data.preferredInd;

  const [row] = await db
    .update(ingredientSupplier)
    .set(updates)
    .where(
      and(
        eq(ingredientSupplier.ingredientId, ingredientId),
        eq(ingredientSupplier.supplierId, supplierId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Remove a supplier from an ingredient (soft-delete). */
export async function removeIngredientSupplier(ingredientId: string, supplierId: string) {
  const [row] = await db
    .update(ingredientSupplier)
    .set({ activeInd: false, updatedDttm: new Date() })
    .where(
      and(
        eq(ingredientSupplier.ingredientId, ingredientId),
        eq(ingredientSupplier.supplierId, supplierId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Count how many active ingredients each supplier is assigned to. */
export async function getSupplierItemCounts(organisationId: number) {
  return db
    .select({
      supplierId: ingredientSupplier.supplierId,
      itemCount: count(ingredientSupplier.ingredientSupplierId),
    })
    .from(ingredientSupplier)
    .innerJoin(supplier, eq(supplier.supplierId, ingredientSupplier.supplierId))
    .where(
      and(
        eq(supplier.organisationId, organisationId),
        eq(ingredientSupplier.activeInd, true),
      ),
    )
    .groupBy(ingredientSupplier.supplierId);
}
