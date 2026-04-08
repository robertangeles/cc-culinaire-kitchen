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
});

const UpdateIngredientSchema = z.object({
  ingredientName: z.string().min(1).max(200).optional(),
  ingredientCategory: z.enum(VALID_CATEGORIES).optional(),
  baseUnit: z.string().min(1).max(20).optional(),
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
  unitOverride: z.string().max(20).nullable().optional(),
  categoryOverride: z.enum(VALID_CATEGORIES).nullable().optional(),
  activeInd: z.boolean().optional(),
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
