/**
 * @module controllers/workforceController
 *
 * Input validation + response formatting for Workforce Optimisation
 * (Phase 3). `orgId` is always derived from the authenticated user via
 * `getUserLocationContext` — never from the client — same pattern
 * `rosterController.ts` already established.
 */

import type { Request, Response, NextFunction } from "express";
import { getUserLocationContext } from "../services/locationContextService.js";
import { getStationDemand } from "../services/workforceDemandService.js";
import { getStaffingCoverage } from "../services/staffingCoverageService.js";
import { RosterError } from "../services/rosterService.js";

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof RosterError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    next(err);
  }
}

async function resolveContext(req: Request, res: Response): Promise<{ orgId: number } | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.organisationId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return { orgId: ctx.organisationId };
}

export async function handleGetWorkforceDemand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { storeLocationId, forDate } = req.query;
    if (typeof storeLocationId !== "string" || typeof forDate !== "string") {
      res.status(400).json({ error: "storeLocationId and forDate are required" });
      return;
    }
    res.json(await getStationDemand(ctx.orgId, storeLocationId, forDate));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleGetStaffingCoverage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { storeLocationId, from, to } = req.query;
    if (typeof storeLocationId !== "string" || typeof from !== "string" || typeof to !== "string") {
      res.status(400).json({ error: "storeLocationId, from, and to are required" });
      return;
    }
    res.json(await getStaffingCoverage(ctx.orgId, storeLocationId, from, to));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}
