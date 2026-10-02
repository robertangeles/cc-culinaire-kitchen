/**
 * @module controllers/fohController
 *
 * Input validation + response formatting for the front-of-house (FOH) stock
 * loop: view the shelf, stock the fridge (BOH->FOH), reconcile a count, log
 * front-shelf waste, record sales (which deduct FOH), and the sales report.
 *
 * Thin controllers — all logic lives in fohStockService / fohSalesService /
 * consumptionLogService.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext, getLocationInOrg } from "../services/locationContextService.js";
import * as fohStockService from "../services/fohStockService.js";
import { FohError } from "../services/fohStockService.js";
import * as fohSalesService from "../services/fohSalesService.js";
import * as consumptionLogService from "../services/consumptionLogService.js";

const logger = pino({ name: "fohController" });

/** Resolve the caller's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return orgId;
}

/** Verify the :locId path param belongs to the caller's org. */
async function requireLocation(req: Request, res: Response, orgId: number): Promise<string | null> {
  const locId = req.params.locId as string;
  if (!(await getLocationInOrg(locId, orgId))) {
    res.status(404).json({ error: "Location not found" });
    return null;
  }
  return locId;
}

/** Map a thrown FohError to its HTTP status; otherwise bubble to the handler. */
function handleFohError(err: unknown, res: Response, next: NextFunction, where: string): void {
  if (err instanceof FohError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  logger.error(err, `${where} failed`);
  next(err as Error);
}

// ─── FOH shelf view ─────────────────────────────────────────────

/** GET /locations/:locId/foh — every FOH consumable with BOH + FOH qty. */
export async function handleGetFohStock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    res.json(await fohStockService.getFohStock(locId));
  } catch (err) {
    handleFohError(err, res, next, "handleGetFohStock");
  }
}

// ─── Restock (BOH -> FOH) ───────────────────────────────────────

/** POST /locations/:locId/foh/restock  { ingredientId, quantity } */
export async function handleRestockFoh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { ingredientId, quantity } = req.body;
    if (!ingredientId) {
      res.status(400).json({ error: "ingredientId is required" });
      return;
    }
    if (quantity === undefined || Number(quantity) <= 0) {
      res.status(400).json({ error: "quantity must be greater than 0" });
      return;
    }

    res.json(await fohStockService.moveToFoh(orgId, locId, ingredientId, Number(quantity)));
  } catch (err) {
    handleFohError(err, res, next, "handleRestockFoh");
  }
}

/** GET /locations/:locId/foh/restock-suggestions — restock-to-par list. */
export async function handleGetRestockSuggestions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    res.json(await fohStockService.suggestFohRestock(locId));
  } catch (err) {
    handleFohError(err, res, next, "handleGetRestockSuggestions");
  }
}

// ─── FOH count ──────────────────────────────────────────────────

/** POST /locations/:locId/foh/count  { ingredientId, countedQty } */
export async function handleCountFoh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { ingredientId, countedQty } = req.body;
    if (!ingredientId) {
      res.status(400).json({ error: "ingredientId is required" });
      return;
    }
    if (countedQty === undefined || Number(countedQty) < 0) {
      res.status(400).json({ error: "countedQty must be 0 or greater" });
      return;
    }

    res.json(await fohStockService.recountFoh(orgId, locId, ingredientId, Number(countedQty), req.user!.sub));
  } catch (err) {
    handleFohError(err, res, next, "handleCountFoh");
  }
}

// ─── FOH waste ──────────────────────────────────────────────────

/** POST /locations/:locId/foh/waste  { ingredientId, quantity, unit, reason?, notes? } */
export async function handleLogFohWaste(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { ingredientId, quantity, unit, reason, notes } = req.body;
    if (!ingredientId) {
      res.status(400).json({ error: "ingredientId is required" });
      return;
    }
    if (quantity === undefined || Number(quantity) <= 0) {
      res.status(400).json({ error: "quantity must be greater than 0" });
      return;
    }
    if (!unit) {
      res.status(400).json({ error: "unit is required" });
      return;
    }

    // FOH waste is a consumption event against the FOH zone.
    const entry = await consumptionLogService.logConsumption(orgId, locId, req.user!.sub, {
      ingredientId,
      quantity: Number(quantity),
      unit,
      reason: reason || "waste",
      notes: notes || null,
      zone: "FOH",
    });
    res.status(201).json(entry);
  } catch (err) {
    handleFohError(err, res, next, "handleLogFohWaste");
  }
}

// ─── Record sales (deduct FOH) ──────────────────────────────────

/** POST /locations/:locId/sales  { lines: [{ ingredientId, quantity, unitPrice?, soldAt? }], source? } */
export async function handleRecordSales(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { lines, source } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines must be a non-empty array" });
      return;
    }
    const src = source === "CSV" ? "CSV" : "MANUAL";

    const parsed: fohSalesService.SaleLineInput[] = lines.map((l: Record<string, unknown>) => ({
      ingredientId: String(l.ingredientId ?? ""),
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice === undefined || l.unitPrice === null || l.unitPrice === "" ? null : Number(l.unitPrice),
      soldAt: l.soldAt ? new Date(String(l.soldAt)) : undefined,
    }));

    const result = await fohSalesService.recordFohSales(orgId, locId, parsed, src, req.user!.sub);
    res.status(201).json(result);
  } catch (err) {
    handleFohError(err, res, next, "handleRecordSales");
  }
}

/** GET /locations/:locId/foh/sales — recent sales list. */
export async function handleListSales(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { startDate, endDate, limit } = req.query;
    res.json(
      await fohSalesService.listFohSales(locId, orgId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  } catch (err) {
    handleFohError(err, res, next, "handleListSales");
  }
}

/** GET /locations/:locId/foh/sales-report — revenue / COGS / margin. */
export async function handleSalesReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const locId = await requireLocation(req, res, orgId);
    if (locId === null) return;

    const { startDate, endDate } = req.query;
    res.json(
      await fohSalesService.getFohSalesReport(orgId, {
        storeLocationId: locId,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      }),
    );
  } catch (err) {
    handleFohError(err, res, next, "handleSalesReport");
  }
}
