/**
 * @module controllers/purchaseOrderController
 *
 * Input validation and response formatting for Wave 3 Purchase Orders.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  createPO,
  listPOs,
  getPODetail,
  submitPO,
  receiveLine,
  cancelPO,
  getSuggestions,
} from "../services/purchaseOrderService.js";

const logger = pino({ name: "purchaseOrderController" });

// ─── Schemas ──────────────────────────────────────────────────────

const CreatePOLineSchema = z.object({
  ingredientId: z.string().uuid(),
  orderedQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number",
  ),
  orderedUnit: z.string().min(1).max(20),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
});

const CreatePOSchema = z.object({
  storeLocationId: z.string().uuid(),
  supplierId: z.string().uuid(),
  lines: z.array(CreatePOLineSchema).min(1, "At least one line item is required"),
  notes: z.string().max(2000).optional(),
  expectedDeliveryDate: z.string().optional(),
});

const ReceiveLineSchema = z.object({
  receivedQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number",
  ),
  receivedUnit: z.string().min(1).max(20),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).nullable().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Handlers ─────────────────────────────────────────────────────

export async function handleCreatePO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreatePOSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.sub;
    const result = await createPO({
      orgId,
      locationId: parsed.data.storeLocationId,
      supplierId: parsed.data.supplierId,
      userId,
      lines: parsed.data.lines,
      notes: parsed.data.notes,
      expectedDate: parsed.data.expectedDeliveryDate,
    });

    logger.info({ poId: result.poId, userId }, "Purchase order created");
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleListPOs(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const status = req.query.status as string | undefined;
    const storeLocationId = req.query.storeLocationId as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = await listPOs(orgId, { status, storeLocationId, limit, offset });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleGetPODetail(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const result = await getPODetail(poId, orgId);

    if (!result) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleSubmitPO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const result = await submitPO(poId, orgId, userId);
    logger.info({ poId, userId }, "Purchase order submitted");
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("Cannot submit") || err.message?.includes("not found")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleReceiveLine(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const lineId = req.params.lineId as string;
    const userId = req.user!.sub;

    const parsed = ReceiveLineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const result = await receiveLine(
      poId,
      lineId,
      parsed.data.receivedQty,
      parsed.data.receivedUnit,
      parsed.data.unitCost ?? null,
      userId,
    );

    logger.info({ poId, lineId, userId }, "PO line received");
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("Cannot receive") || err.message?.includes("not found") || err.message?.includes("already received")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleCancelPO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const result = await cancelPO(poId, orgId, userId);
    logger.info({ poId, userId }, "Purchase order cancelled");
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("Cannot cancel") || err.message?.includes("not found")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function handleGetSuggestions(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const storeLocationId = req.query.storeLocationId as string;
    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query parameter is required" });
      return;
    }

    const result = await getSuggestions(storeLocationId, orgId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
