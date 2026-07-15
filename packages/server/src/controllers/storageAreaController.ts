/**
 * @module controllers/storageAreaController
 *
 * Input validation and response formatting for storage areas (count sheets)
 * and stock movements (area-to-area audit notes, zero stock effect).
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  listAreas,
  createArea,
  updateArea,
  deactivateArea,
  listAreaItems,
  setAreaItems,
  getAssignmentMap,
  StorageAreaError,
} from "../services/storageAreaService.js";
import {
  createMovement,
  listMovements,
  StockMovementError,
} from "../services/stockMovementService.js";
import { IncompatibleUnitsError } from "@culinaire/shared";

const logger = pino({ name: "storageAreaController" });

const CreateAreaSchema = z.object({
  areaName: z.string().min(1).max(50),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const UpdateAreaSchema = z
  .object({
    areaName: z.string().min(1).max(50).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    activeInd: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

const SetAreaItemsSchema = z.object({
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        areaParLevel: z.number().min(0).max(999999).nullable().optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
    )
    .max(2000),
});

const CreateMovementSchema = z.object({
  ingredientId: z.string().uuid(),
  fromStorageAreaId: z.string().uuid(),
  toStorageAreaId: z.string().uuid(),
  quantity: z.number().positive().max(99999),
  unit: z.string().min(1).max(20),
  notes: z.string().max(500).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof StorageAreaError || err instanceof StockMovementError) {
    res.status(err.statusCode).json({ error: err.message });
  } else if (err instanceof IncompatibleUnitsError) {
    res.status(400).json({ error: err.message });
  } else {
    next(err);
  }
}

/** Resolve org from the user's context. */
async function resolveContext(req: Request, res: Response) {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return { orgId: ctx.locations[0].organisationId, isOrgAdmin: ctx.isOrgAdmin };
}

// ─── Areas ────────────────────────────────────────────────────────

export async function handleListAreas(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const includeInactive = req.query.includeInactive === "true";
    res.json(await listAreas(req.params.locId as string, ctx.orgId, includeInactive));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateArea(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = CreateAreaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const area = await createArea(
      req.params.locId as string,
      ctx.orgId,
      parsed.data.areaName,
      parsed.data.sortOrder,
    );
    logger.info(
      { storageAreaId: area.storageAreaId, locationId: req.params.locId, userId: req.user!.sub },
      "Storage area created",
    );
    res.status(201).json(area);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpdateArea(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = UpdateAreaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    res.json(await updateArea(req.params.areaId as string, ctx.orgId, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleDeactivateArea(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const area = await deactivateArea(req.params.areaId as string, ctx.orgId);
    logger.info(
      { storageAreaId: req.params.areaId, userId: req.user!.sub },
      "Storage area deactivated",
    );
    res.json(area);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListAreaItems(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listAreaItems(req.params.areaId as string, ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSetAreaItems(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = SetAreaItemsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const items = await setAreaItems(req.params.areaId as string, ctx.orgId, parsed.data.items);
    logger.info(
      { storageAreaId: req.params.areaId, itemCount: items.length, userId: req.user!.sub },
      "Storage area items set",
    );
    res.json(items);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetAssignmentMap(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await getAssignmentMap(req.params.locId as string, ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ─── Movements ────────────────────────────────────────────────────

export async function handleCreateMovement(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = CreateMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const movement = await createMovement(
      req.params.locId as string,
      ctx.orgId,
      req.user!.sub,
      parsed.data,
    );
    logger.info(
      {
        stockMovementId: movement.stockMovementId,
        locationId: req.params.locId,
        userId: req.user!.sub,
        stockEffect: "none",
      },
      "Stock movement recorded",
    );
    res.status(201).json(movement);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListMovements(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    // Validate before it reaches SQL: a non-UUID makes Postgres throw
    // "invalid input syntax for type uuid", which isn't a StockMovementError,
    // so it would fall through to the generic handler as a 500. The write side
    // already validates this; the read side should too.
    const parsedIngredientId = z.string().uuid().optional().safeParse(
      typeof req.query.ingredientId === "string" ? req.query.ingredientId : undefined,
    );
    if (!parsedIngredientId.success) {
      res.status(400).json({ error: "That item id isn't valid" });
      return;
    }
    const ingredientId = parsedIngredientId.data;
    const limit = req.query.limit ? Math.min(Number(req.query.limit) || 100, 500) : undefined;

    res.json(await listMovements(req.params.locId as string, ctx.orgId, { ingredientId, limit }));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}
