/**
 * @module controllers/ingredientAliasController
 *
 * REST handlers for ingredient aliases (catalog-spine Phase 1).
 *
 * Routes:
 *   POST   /api/inventory/ingredient-aliases/match-bulk  — recipe import matcher
 *   GET    /api/inventory/ingredients/:id/aliases        — list aliases for ingredient
 *   POST   /api/inventory/ingredients/:id/aliases        — create new alias
 *   DELETE /api/inventory/ingredient-aliases/:aliasId    — remove alias
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  matchBulk,
  listAliasesForIngredient,
  createAlias,
  deleteAlias,
} from "../services/ingredientAliasService.js";
import { getIngredient } from "../services/ingredientService.js";

const MatchBulkSchema = z.object({
  /** Up to 100 ingredient names to match against the Catalog. */
  queries: z.array(z.string().min(1).max(300)).min(1).max(100),
});

const CreateAliasSchema = z.object({
  aliasText: z.string().min(1).max(200),
});

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

export async function handleMatchBulk(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = MatchBulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const results = await matchBulk(orgId, parsed.data.queries);
    res.json({ results });
  } catch (err) {
    next(err);
  }
}

export async function handleListAliases(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;
    const ingredientId = req.params.id as string;
    const rows = await listAliasesForIngredient(ingredientId);
    // Filter to org scope as a defensive belt — the FK should already
    // ensure the alias belongs to this org via the ingredient row.
    const scoped = rows.filter((r) => r.organisationId === orgId);
    res.json(scoped);
  } catch (err) {
    next(err);
  }
}

export async function handleCreateAlias(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreateAliasSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const ingredientId = req.params.id as string;
    const ing = await getIngredient(ingredientId, orgId);
    if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }

    const row = await createAlias(orgId, ingredientId, parsed.data.aliasText, req.user!.sub);
    res.status(201).json(row);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "An alias with this text already exists in your organisation" });
      return;
    }
    next(err);
  }
}

export async function handleDeleteAlias(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const aliasId = req.params.aliasId as string;
    await deleteAlias(aliasId, orgId, req.user!.sub);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}
