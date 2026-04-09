/**
 * @module controllers/forecastController
 *
 * Input validation and response formatting for AI-powered
 * stock forecasting and reorder recommendations.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext } from "../services/locationContextService.js";
import * as forecastService from "../services/forecastService.js";

const logger = pino({ name: "forecastController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.locations.length === 0) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return ctx.locations[0].organisationId;
}

// ─── Generate forecasts ─────────────────────────────────────────

/** POST /forecasts/generate */
export async function handleGenerateForecasts(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { storeLocationId } = req.body;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId is required" });
      return;
    }

    const count = await forecastService.generateForecasts(storeLocationId, orgId);

    res.json({ generated: count });
  } catch (err) {
    logger.error(err, "handleGenerateForecasts failed");
    next(err);
  }
}

// ─── List recommendations ───────────────────────────────────────

/** GET /forecasts */
export async function handleListRecommendations(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { storeLocationId, status, limit } = req.query;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query param is required" });
      return;
    }

    const recs = await forecastService.listRecommendations(
      storeLocationId as string,
      {
        status: status as string | undefined,
        limit: limit ? Number(limit) : undefined,
      },
    );

    res.json(recs);
  } catch (err) {
    logger.error(err, "handleListRecommendations failed");
    next(err);
  }
}

// ─── Dismiss recommendation ─────────────────────────────────────

/** POST /forecasts/:id/dismiss */
export async function handleDismiss(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const rec = await forecastService.dismissRecommendation(req.params.id as string, orgId);
    res.json(rec);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error(err, "handleDismiss failed");
    next(err);
  }
}

// ─── Mark ordered ───────────────────────────────────────────────

/** POST /forecasts/:id/ordered */
export async function handleMarkOrdered(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { poId } = req.body;
    const rec = await forecastService.markOrdered(req.params.id as string, orgId, poId);
    res.json(rec);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    logger.error(err, "handleMarkOrdered failed");
    next(err);
  }
}
