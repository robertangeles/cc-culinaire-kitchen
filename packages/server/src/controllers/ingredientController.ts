/**
 * @module controllers/ingredientController
 *
 * Input validation and response formatting for the org-wide ingredient
 * catalog and per-location ingredient configuration.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  createIngredient,
  listIngredients,
  getIngredient,
  updateIngredient,
  listLocationIngredients,
  updateLocationIngredient,
  addUnitConversion,
  listUnitConversions,
  deleteUnitConversion,
  createSupplier,
  listSuppliers,
  updateSupplier,
  deleteSupplier,
  getIngredientStockAcrossLocations,
  getSupplierLocations,
  setSupplierLocations,
  assignSupplierToIngredient,
  listIngredientSuppliers,
  updateIngredientSupplier,
  removeIngredientSupplier,
} from "../services/ingredientService.js";
import { invalidateConversionCache } from "../services/unitConversionService.js";

const logger = pino({ name: "ingredientController" });

const VALID_CATEGORIES = [
  "proteins", "produce", "dairy", "dry_goods", "beverages",
  "spirits", "frozen", "bakery", "condiments", "other",
] as const;

const CreateIngredientSchema = z.object({
  ingredientName: z.string().min(1).max(200),
  ingredientCategory: z.enum(VALID_CATEGORIES),
  baseUnit: z.string().min(1).max(20),
  description: z.string().max(2000).optional(),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  parLevel: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  reorderQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  containsDairyInd: z.boolean().optional(),
  containsGlutenInd: z.boolean().optional(),
  containsNutsInd: z.boolean().optional(),
  containsShellfishInd: z.boolean().optional(),
  containsEggsInd: z.boolean().optional(),
  isVegetarianInd: z.boolean().optional(),
});

const UpdateIngredientSchema = z.object({
  ingredientName: z.string().min(1).max(200).optional(),
  ingredientCategory: z.enum(VALID_CATEGORIES).optional(),
  baseUnit: z.string().min(1).max(20).optional(),
  description: z.string().max(2000).nullable().optional(),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  parLevel: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  reorderQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  containsDairyInd: z.boolean().optional(),
  containsGlutenInd: z.boolean().optional(),
  containsNutsInd: z.boolean().optional(),
  containsShellfishInd: z.boolean().optional(),
  containsEggsInd: z.boolean().optional(),
  isVegetarianInd: z.boolean().optional(),
});

const AddConversionSchema = z.object({
  fromUnit: z.string().min(1).max(20),
  toBaseFactor: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Must be a positive number",
  ),
});

const UpdateLocationIngredientSchema = z.object({
  parLevel: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0,
    "Must be a non-negative number",
  ).optional(),
  reorderQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0,
    "Must be a non-negative number",
  ).optional(),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0,
    "Must be a non-negative number",
  ).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  unitOverride: z.string().max(20).nullable().optional(),
  categoryOverride: z.enum(VALID_CATEGORIES).nullable().optional(),
  activeInd: z.boolean().optional(),
});

const SUPPLIER_CATEGORIES = ["food", "packaging", "cleaning", "equipment", "multi"] as const;
const PAYMENT_TERMS = ["cod", "net_7", "net_14", "net_30", "net_60", "prepaid"] as const;
const ORDERING_METHODS = ["email", "phone", "portal", "edi", "in_person"] as const;

const CreateSupplierSchema = z.object({
  supplierName: z.string().min(1).max(200),
  supplierCategory: z.enum(SUPPLIER_CATEGORIES).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  orderingMethod: z.enum(ORDERING_METHODS).optional(),
  deliveryDays: z.string().max(100).optional(),
  currency: z.string().length(3).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().max(50).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  minimumOrderValue: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  notes: z.string().max(2000).optional(),
  locationIds: z.array(z.string().uuid()).optional(),
});

const UpdateSupplierSchema = z.object({
  supplierName: z.string().min(1).max(200).optional(),
  supplierCategory: z.enum(SUPPLIER_CATEGORIES).nullable().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).nullable().optional(),
  orderingMethod: z.enum(ORDERING_METHODS).nullable().optional(),
  deliveryDays: z.string().max(100).nullable().optional(),
  currency: z.string().length(3).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().max(255).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  minimumOrderValue: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  locationIds: z.array(z.string().uuid()).optional(),
});

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Org-wide ingredient CRUD ─────────────────────────────────────

export async function handleCreateIngredient(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreateIngredientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const row = await createIngredient(orgId, parsed.data);
    logger.info({ ingredientId: row.ingredientId, userId: req.user!.sub }, "Ingredient created");
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "An ingredient with this name already exists" });
      return;
    }
    next(err);
  }
}

export async function handleListIngredients(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    const rows = await listIngredients(orgId, { category, search });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateIngredient(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = UpdateIngredientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const row = await updateIngredient(req.params.id as string, orgId, parsed.data);
    if (!row) { res.status(404).json({ error: "Ingredient not found" }); return; }

    logger.info({ ingredientId: row.ingredientId, userId: req.user!.sub }, "Ingredient updated");
    res.json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "An ingredient with this name already exists" });
      return;
    }
    next(err);
  }
}

// ─── Unit conversions ─────────────────────────────────────────────

export async function handleAddConversion(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const ing = await getIngredient(req.params.id as string, orgId);
    if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }

    const parsed = AddConversionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const row = await addUnitConversion(req.params.id as string, parsed.data.fromUnit, parsed.data.toBaseFactor);
    invalidateConversionCache(req.params.id as string);
    logger.info({ ingredientId: req.params.id as string, fromUnit: parsed.data.fromUnit }, "Unit conversion added");
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A conversion for this unit already exists" });
      return;
    }
    next(err);
  }
}

export async function handleListConversions(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const ing = await getIngredient(req.params.id as string, orgId);
    if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }

    const rows = await listUnitConversions(req.params.id as string);
    res.json({ baseUnit: ing.baseUnit, conversions: rows });
  } catch (err) {
    next(err);
  }
}

export async function handleDeleteConversion(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const row = await deleteUnitConversion(req.params.conversionId as string);
    if (!row) { res.status(404).json({ error: "Conversion not found" }); return; }

    invalidateConversionCache(row.ingredientId);
    logger.info({ conversionId: req.params.conversionId as string }, "Unit conversion deleted");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

// ─── Location ingredient config ───────────────────────────────────

export async function handleListLocationIngredients(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const rows = await listLocationIngredients(req.params.locId as string, orgId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateLocationIngredient(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = UpdateLocationIngredientSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const row = await updateLocationIngredient(req.params.id as string, req.params.locId as string, parsed.data);
    if (!row) { res.status(404).json({ error: "Location ingredient config not found" }); return; }

    logger.info(
      { ingredientId: req.params.id as string, locationId: req.params.locId as string, userId: req.user!.sub },
      "Location ingredient config updated",
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
}

// ─── Cross-location stock ────────────────────────────────────────

export async function handleGetIngredientStockLevels(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const rows = await getIngredientStockAcrossLocations(req.params.id as string, orgId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// ─── Ingredient-Supplier assignments ─────────────────────────────

const AssignSupplierSchema = z.object({
  supplierId: z.string().uuid(),
  costPerUnit: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  supplierItemCode: z.string().max(100).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  minimumOrderQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
  preferredInd: z.boolean().optional(),
});

const UpdateIngredientSupplierSchema = z.object({
  costPerUnit: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  supplierItemCode: z.string().max(100).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  minimumOrderQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
  preferredInd: z.boolean().optional(),
});

export async function handleAssignSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = AssignSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { supplierId, ...data } = parsed.data;
    const row = await assignSupplierToIngredient(req.params.id as string, supplierId, data);
    logger.info({ ingredientId: req.params.id, supplierId, userId: req.user!.sub }, "Supplier assigned to ingredient");
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "This supplier is already assigned to this item" });
      return;
    }
    next(err);
  }
}

export async function handleListIngredientSuppliers(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const rows = await listIngredientSuppliers(req.params.id as string);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateIngredientSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = UpdateIngredientSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const row = await updateIngredientSupplier(req.params.id as string, req.params.supId as string, parsed.data);
    if (!row) { res.status(404).json({ error: "Supplier assignment not found" }); return; }

    logger.info({ ingredientId: req.params.id, supplierId: req.params.supId, userId: req.user!.sub }, "Ingredient supplier updated");
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function handleRemoveIngredientSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const row = await removeIngredientSupplier(req.params.id as string, req.params.supId as string);
    if (!row) { res.status(404).json({ error: "Supplier assignment not found" }); return; }

    logger.info({ ingredientId: req.params.id, supplierId: req.params.supId, userId: req.user!.sub }, "Supplier removed from ingredient");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

// ─── Supplier CRUD ───────────────────────────────────────────────

export async function handleCreateSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { locationIds, ...supplierData } = parsed.data;
    const row = await createSupplier(orgId, supplierData);
    if (locationIds && locationIds.length > 0) {
      await setSupplierLocations(row.supplierId, locationIds);
    }
    logger.info({ supplierId: row.supplierId, userId: req.user!.sub }, "Supplier created");
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A supplier with this name already exists" });
      return;
    }
    next(err);
  }
}

export async function handleListSuppliers(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const rows = await listSuppliers(orgId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

export async function handleUpdateSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = UpdateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { locationIds, ...supplierData } = parsed.data;
    const row = await updateSupplier(req.params.id as string, orgId, supplierData);
    if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }
    if (locationIds !== undefined) {
      await setSupplierLocations(row.supplierId, locationIds);
    }
    logger.info({ supplierId: row.supplierId, userId: req.user!.sub }, "Supplier updated");
    res.json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "A supplier with this name already exists" });
      return;
    }
    next(err);
  }
}

export async function handleDeleteSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const row = await deleteSupplier(req.params.id as string, orgId);
    if (!row) { res.status(404).json({ error: "Supplier not found" }); return; }

    logger.info({ supplierId: row.supplierId, userId: req.user!.sub }, "Supplier soft-deleted");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function handleGetSupplierLocations(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const rows = await getSupplierLocations(req.params.id as string);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}
