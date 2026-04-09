/**
 * @module services/ingredientService
 *
 * CRUD operations for the org-wide ingredient catalog and
 * per-location ingredient configuration (par levels, unit overrides).
 */

import { eq, and, ilike, ne, sql, count, inArray, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient,
  locationIngredient,
  unitConversion,
  stockLevel,
  supplier,
  supplierLocation,
  ingredientSupplier,
  storeLocation,
  pendingCatalogRequest,
  stockTakeLine,
  stockTakeCategory,
  stockTakeSession,
  consumptionLog,
  user,
} from "../db/schema.js";

// ─── Org-wide ingredient catalog ──────────────────────────────────

/** Create a new ingredient in the org catalog. */
export async function createIngredient(
  organisationId: number,
  data: {
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
  },
) {
  const [row] = await db
    .insert(ingredient)
    .values({
      organisationId,
      ingredientName: data.ingredientName.trim(),
      ingredientCategory: data.ingredientCategory,
      baseUnit: data.baseUnit,
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
  return row;
}

/** List all ingredients for an organisation, optionally filtered by category. */
export async function listIngredients(
  organisationId: number,
  opts?: { category?: string; search?: string; itemType?: string },
) {
  let query = db
    .select()
    .from(ingredient)
    .where(eq(ingredient.organisationId, organisationId))
    .$dynamic();

  if (opts?.category) {
    query = query.where(
      and(
        eq(ingredient.organisationId, organisationId),
        eq(ingredient.ingredientCategory, opts.category),
      ),
    );
  }

  if (opts?.search) {
    query = query.where(
      and(
        eq(ingredient.organisationId, organisationId),
        ilike(ingredient.ingredientName, `%${opts.search}%`),
      ),
    );
  }

  if (opts?.itemType) {
    query = query.where(
      and(
        eq(ingredient.organisationId, organisationId),
        eq(ingredient.itemType, opts.itemType),
      ),
    );
  }

  return query;
}

/** Get a single ingredient by ID (with org guard). */
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

/** Update an ingredient's fields. */
export async function updateIngredient(
  ingredientId: string,
  organisationId: number,
  data: Partial<{
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
  }>,
) {
  const updates: Record<string, unknown> = { updatedDttm: new Date() };
  if (data.ingredientName !== undefined) updates.ingredientName = data.ingredientName.trim();
  if (data.ingredientCategory !== undefined) updates.ingredientCategory = data.ingredientCategory;
  if (data.baseUnit !== undefined) updates.baseUnit = data.baseUnit;
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
  return row ?? null;
}

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
      baseUnit: ingredient.baseUnit,
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

/** Delete a unit conversion. */
export async function deleteUnitConversion(conversionId: string) {
  const [row] = await db
    .delete(unitConversion)
    .where(eq(unitConversion.conversionId, conversionId))
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
) {
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

// ─── Ingredient-Supplier assignments ─────────────────────────────

/** Assign a supplier to an ingredient with cost/SKU. */
export async function assignSupplierToIngredient(
  ingredientId: string,
  supplierId: string,
  data: {
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
    throw new Error(`Ingredients not found in organisation: ${invalidIds.join(", ")}`);
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
    throw new Error(`Ingredients not found in organisation: ${invalidIds.join(", ")}`);
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
    throw new Error("Source location has no activated items");
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
  // Parse month to date range
  const [year, mon] = month.split("-").map(Number);
  const startDate = new Date(year, mon - 1, 1);
  const endDate = new Date(year, mon, 1); // first day of next month

  // 1. Stock take lines for this ingredient in this month
  // Join: stockTakeLine -> stockTakeCategory -> stockTakeSession (for org filter)
  const stockTakeRows = await db
    .select({
      id: stockTakeLine.lineId,
      quantity: stockTakeLine.countedQty,
      unit: stockTakeLine.countedUnit,
      occurredAt: stockTakeLine.countedDttm,
      userId: stockTakeLine.countedByUserId,
      userName: user.userName,
    })
    .from(stockTakeLine)
    .innerJoin(stockTakeCategory, eq(stockTakeCategory.categoryId, stockTakeLine.categoryId))
    .innerJoin(stockTakeSession, eq(stockTakeSession.sessionId, stockTakeCategory.sessionId))
    .innerJoin(user, eq(user.userId, stockTakeLine.countedByUserId))
    .where(
      and(
        eq(stockTakeLine.ingredientId, ingredientId),
        eq(stockTakeSession.organisationId, organisationId),
        gte(stockTakeLine.countedDttm, startDate),
        sql`${stockTakeLine.countedDttm} < ${endDate}`,
      ),
    );

  // 2. Consumption log entries
  const consumptionRows = await db
    .select({
      id: consumptionLog.consumptionLogId,
      quantity: consumptionLog.quantity,
      unit: consumptionLog.unit,
      reason: consumptionLog.reason,
      shift: consumptionLog.shift,
      occurredAt: consumptionLog.loggedAt,
      userId: consumptionLog.userId,
      userName: user.userName,
    })
    .from(consumptionLog)
    .innerJoin(user, eq(user.userId, consumptionLog.userId))
    .where(
      and(
        eq(consumptionLog.ingredientId, ingredientId),
        eq(consumptionLog.organisationId, organisationId),
        gte(consumptionLog.loggedAt, startDate),
        sql`${consumptionLog.loggedAt} < ${endDate}`,
      ),
    );

  // 3. Waste log entries — waste_log uses ingredient_name (text), not ingredient_id (FK)
  // First get the ingredient name to match
  const [ing] = await db
    .select({ name: ingredient.ingredientName })
    .from(ingredient)
    .where(eq(ingredient.ingredientId, ingredientId));

  let wasteRows: any[] = [];
  if (ing) {
    try {
      const wasteResult = await db.execute(sql`
        SELECT
          wl.waste_log_id as id,
          wl.quantity,
          wl.unit,
          wl.reason,
          wl.logged_at as occurred_at,
          wl.user_id,
          u.user_name as user_name
        FROM waste_log wl
        INNER JOIN "user" u ON u.user_id = wl.user_id
        WHERE wl.ingredient_name = ${ing.name}
          AND wl.organisation_id = ${organisationId}
          AND wl.logged_at >= ${startDate.toISOString()}
          AND wl.logged_at < ${endDate.toISOString()}
      `);
      wasteRows = (wasteResult as any[]) || [];
    } catch {
      // waste_log table might not exist or have different schema — gracefully skip
      wasteRows = [];
    }
  }

  // Merge all into unified TransactionEvent[]
  const transactions = [
    ...stockTakeRows.map((r) => ({
      id: r.id,
      type: "stock_take" as const,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: null,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
    ...consumptionRows.map((r) => ({
      id: r.id,
      type: "transfer" as const,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: r.reason,
      userName: r.userName || "Unknown",
      occurredAt: r.occurredAt instanceof Date ? r.occurredAt.toISOString() : String(r.occurredAt),
    })),
    ...wasteRows.map((r: any) => ({
      id: r.id || r.waste_log_id,
      type: "waste" as const,
      quantity: String(r.quantity),
      unit: r.unit,
      reason: r.reason,
      userName: r.user_name || r.userName || "Unknown",
      occurredAt: typeof r.occurred_at === "string" ? r.occurred_at : r.occurred_at?.toISOString?.() || "",
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  // Extract unique dates for calendar dots
  const transactionDates = [...new Set(
    transactions.map((t) => t.occurredAt.slice(0, 10)),
  )];

  return { transactions, transactionDates };
}
