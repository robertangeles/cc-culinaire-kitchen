/**
 * @module controllers/forecastController
 *
 * Input validation and response formatting for AI-powered
 * stock forecasting and reorder recommendations.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { getUserLocationContext, getLocationInOrg } from "../services/locationContextService.js";
import * as forecastService from "../services/forecastService.js";

const logger = pino({ name: "forecastController" });

/** Resolve the user's org ID from their location context. */
async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  // Prefer a location's org; fall back to the admin's org membership so a
  // location-less org admin can still manage org-wide records (e.g. suppliers).
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return orgId;
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

    if (!await getLocationInOrg(storeLocationId, orgId)) {
      res.status(400).json({ error: "Location not found" });
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
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const { storeLocationId, status, limit } = req.query;

    if (!storeLocationId) {
      res.status(400).json({ error: "storeLocationId query param is required" });
      return;
    }

    if (!await getLocationInOrg(storeLocationId as string, orgId)) {
      res.status(400).json({ error: "Location not found" });
      return;
    }

    const recs = await forecastService.listRecommendations(
      storeLocationId as string,
      orgId,
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

    const rec = await forecastService.markOrdered(req.params.id as string, orgId);
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
