/**
 * @module controllers/orderGuideController
 *
 * Input validation + response formatting for order guides (Purchasing P1).
 * Reads/ordering gate on `purchasing:draft`; guide management (create/edit/
 * delete/set-items) gates on `inventory:manage` at the route layer.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  listGuides,
  createGuide,
  updateGuide,
  deleteGuide,
  getGuideItems,
  setGuideItems,
  OrderGuideError,
} from "../services/orderGuideService.js";

const logger = pino({ name: "orderGuideController" });

const CreateGuideSchema = z.object({
  supplierId: z.string().uuid(),
  name: z.string().min(1).max(100),
  /** true = an org-wide guide (store_location_id NULL); default = this location. */
  orgWide: z.boolean().optional(),
});

const UpdateGuideSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    activeInd: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });

const SetGuideItemsSchema = z.object({
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        defaultOrderQty: z.number().min(0).max(999999).nullable().optional(),
        defaultPurchaseUnit: z.string().min(1).max(20).nullable().optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
    )
    .max(2000),
});

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof OrderGuideError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    next(err);
  }
}

async function resolveContext(req: Request, res: Response) {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return { orgId: ctx.locations[0].organisationId, isOrgAdmin: ctx.isOrgAdmin };
}

export async function handleListGuides(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const includeInactive = req.query.includeInactive === "true";
    res.json(await listGuides(ctx.orgId, req.params.locId as string, includeInactive));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateGuide(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = CreateGuideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const locId = req.params.locId as string;
    const guide = await createGuide(ctx.orgId, req.user!.sub, {
      supplierId: parsed.data.supplierId,
      name: parsed.data.name,
      storeLocationId: parsed.data.orgWide ? null : locId,
    });
    logger.info({ orderGuideId: guide.orderGuideId, userId: req.user!.sub }, "Order guide created");
    res.status(201).json(guide);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpdateGuide(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = UpdateGuideSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(await updateGuide(req.params.guideId as string, ctx.orgId, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleDeleteGuide(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const guide = await deleteGuide(req.params.guideId as string, ctx.orgId);
    logger.info({ orderGuideId: req.params.guideId, userId: req.user!.sub }, "Order guide deleted");
    res.json(guide);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetGuideItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsedLoc = z.string().uuid().safeParse(req.query.locationId);
    if (!parsedLoc.success) {
      res.status(400).json({ error: "A valid locationId is required" });
      return;
    }
    res.json(await getGuideItems(req.params.guideId as string, ctx.orgId, parsedLoc.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSetGuideItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;

    const parsed = SetGuideItemsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    const items = await setGuideItems(req.params.guideId as string, ctx.orgId, parsed.data.items);
    logger.info(
      { orderGuideId: req.params.guideId, itemCount: items.length, userId: req.user!.sub },
      "Order guide items set",
    );
    res.json(items);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}
