/**
 * @module services/ingredientService
 *
 * CRUD operations for the org-wide ingredient catalog and
 * per-location ingredient configuration (par levels, unit overrides).
 */

import { eq, and, ilike, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient,
  locationIngredient,
  unitConversion,
  stockLevel,
  supplier,
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
  opts?: { category?: string; search?: string },
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
) {
  // Left join: all org ingredients + location overrides + stock + supplier
  const rows = await db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      ingredientCategory: ingredient.ingredientCategory,
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
    .where(eq(ingredient.organisationId, organisationId));

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
