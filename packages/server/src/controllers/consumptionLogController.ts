/**
 * @module controllers/consumptionLogController
 *
 * Input validation and response formatting for consumption log entries.
 * Tracks ingredient usage (waste, prep, spills, etc.) at the location level.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import * as consumptionLogService from "../services/consumptionLogService.js";

const logger = pino({ name: "consumptionLogController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Log consumption ────────────────────────────────────────────

/** POST /consumption-logs */
export async function handleLogConsumption(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const userId = req.user!.sub;
    const { ingredientId, quantity, unit, reason, notes, shift, storeLocationId } = req.body;

    if (!ingredientId) {
      res.status(400).json({ error: "ingredientId is required" });
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      res.status(400).json({ error: "quantity must be greater than 0" });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId is required" });
      return;
    }

    const entry = await consumptionLogService.logConsumption(orgId, storeLocationId, userId, {
      ingredientId,
      quantity: Number(quantity),
      unit,
      reason,
      notes: notes || null,
      shift: shift || null,
    });

    res.status(201).json(entry);
  } catch (err) {
    logger.error(err, "handleLogConsumption failed");
    next(err);
  }
}

// ─── List logs ──────────────────────────────────────────────────

/** GET /consumption-logs */
export async function handleListLogs(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { storeLocationId, startDate, endDate, reason, limit, offset } = req.query;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query param is required" });
      return;
    }

    const logs = await consumptionLogService.listConsumptionLogs(
      storeLocationId as string,
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        reason: reason as string | undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      },
    );

    res.json(logs);
  } catch (err) {
    logger.error(err, "handleListLogs failed");
    next(err);
  }
}

// ─── Consumption summary ────────────────────────────────────────

/** GET /consumption-logs/summary */
export async function handleGetSummary(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { startDate, endDate } = req.query;

    const summary = await consumptionLogService.getConsumptionSummary(orgId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });

    res.json(summary);
  } catch (err) {
    logger.error(err, "handleGetSummary failed");
    next(err);
  }
}

// ─── Edit log ───────────────────────────────────────────────────

/** PATCH /consumption-logs/:id */
export async function handleEditLog(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const userId = req.user!.sub;
    const isAdmin = req.user?.roles?.includes("Administrator") ?? false;
    const { quantity, unit, reason, notes, shift } = req.body;

    const updated = await consumptionLogService.editConsumptionLog(id, orgId, userId, isAdmin, {
      quantity: quantity !== undefined ? Number(quantity) : undefined,
      unit,
      reason,
      notes,
      shift,
    });

    res.json(updated);
  } catch (err: any) {
    if (err.message === "not found") {
      res.status(404).json({ error: "Consumption log entry not found" });
    } else if (err.message === "not authorized") {
      res.status(403).json({ error: "You can only edit your own log entries" });
    } else if (err.message === "expired") {
      res.status(400).json({ error: "Edit window has expired for this entry" });
    } else {
      logger.error(err, "handleEditLog failed");
      next(err);
    }
  }
}

// ─── Delete log ─────────────────────────────────────────────────

/** DELETE /consumption-logs/:id */
export async function handleDeleteLog(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const id = req.params.id as string;
    const userId = req.user!.sub;
    const isAdmin = req.user?.roles?.includes("Administrator") ?? false;

    await consumptionLogService.deleteConsumptionLog(id, orgId, userId, isAdmin);

    res.json({ success: true });
  } catch (err: any) {
    if (err.message === "not found") {
      res.status(404).json({ error: "Consumption log entry not found" });
    } else if (err.message === "not authorized") {
      res.status(403).json({ error: "You can only delete your own log entries" });
    } else if (err.message === "expired") {
      res.status(400).json({ error: "Delete window has expired for this entry" });
    } else {
      logger.error(err, "handleDeleteLog failed");
      next(err);
    }
  }
}
