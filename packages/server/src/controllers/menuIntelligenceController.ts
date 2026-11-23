/**
 * @module controllers/menuIntelligenceController
 *
 * REST handlers for Menu Intelligence — menu items, ingredients,
 * analysis, and category settings.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  createMenuItem,
  getMenuItems,
  requireMenuItem,
  requireManageableMenuItem,
  updateMenuItem,
  deleteMenuItem,
  addIngredient,
  getIngredients,
  deleteIngredient,
  refreshIngredientCost,
  getPandLFoodCost,
  getMenuAnalysis,
  recalculateMenu,
  getCategorySettings,
  upsertCategorySetting,
  importCsvSalesData,
  getItemRecommendations,
  generateReplacementContext,
  getWasteImpactForMenuItems,
} from "../services/menuIntelligenceService.js";
import {
  getYieldVariance,
  listYieldVariance,
} from "../services/yieldVarianceService.js";
import { recordSale, voidSale, listSales, previewSalesCsv, commitSalesCsv, listSellableConsumables, recordConsumableSale } from "../services/saleService.js";
import { assertLocationAccess } from "../services/locationContextService.js";
import { resolveMenuScope, type MenuScope } from "../services/menuAccess.js";
import { AppError } from "../utils/appError.js";

/** 400 with the machine-readable code the phone's queue branches on. */
function invalid(res: Response, message: string): void {
  res.status(400).json({ error: message, code: "VALIDATION" });
}

/** The caller's menu scope (their organisation, or their own items while they have none). */
const menuScope = (req: Request) => resolveMenuScope(req.user!.sub);

/** The caller's scope for a sale, which always belongs to an organisation. */
async function saleScope(req: Request): Promise<MenuScope & { organisationId: number }> {
  const scope = await menuScope(req);
  if (scope.organisationId === null) throw new AppError(400, "VALIDATION", "You are not a member of any organisation");
  return scope as MenuScope & { organisationId: number };
}

const saleBodySchema = z.object({
  qtySold: z.coerce.number().positive("qtySold must be greater than 0"),
  soldAt: z.string().optional().refine((v) => v === undefined || v === "" || !Number.isNaN(new Date(v).getTime()), "soldAt is not a date"),
  locationId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid("locationId is not a location id").optional()),
  idempotencyKey: z.string().max(120, "The idempotency key is longer than 120 characters").optional(),
});

/** The sale fields of a request. The idempotency key may come in the `Idempotency-Key` header or the body; if both are sent they must agree. */
function parseSaleRequest(req: Request, res: Response) {
  const parsed = saleBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalid(res, parsed.error.issues[0].message);
    return null;
  }
  const { qtySold, soldAt, locationId, idempotencyKey: bodyKey } = parsed.data;
  const headerKey = req.header("Idempotency-Key") || undefined;
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    invalid(res, "The Idempotency-Key header and the idempotencyKey field differ");
    return null;
  }
  return { qtySold, soldAt: soldAt ? new Date(soldAt) : undefined, locationId, idempotencyKey: headerKey ?? bodyKey ?? undefined };
}

/** POST /items/:id/sales — record a menu-item sale (recipe → stock depletion). */
export async function handleRecordSale(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    const body = parseSaleRequest(req, res);
    if (!body) return;
    const result = await recordSale(scope.organisationId, scope.userId, { menuItemId: req.params.id as string, ...body, actor: req.user! });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /sales/:saleId/void — reverse a recorded sale (its recorder or an organisation admin). */
export async function handleVoidSale(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    res.json(await voidSale(scope, req.params.saleId as string, req.user!));
  } catch (err) {
    next(err);
  }
}

/** GET /locations/:locId/sales — recent sales for a location. */
export async function handleListSales(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listSales(scope.organisationId, req.params.locId as string, limit));
  } catch (err) {
    next(err);
  }
}

/** GET /consumables — sellable FOH consumables for the Record-sale picker. */
export async function handleListConsumables(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    res.json(await listSellableConsumables(scope.organisationId));
  } catch (err) {
    next(err);
  }
}

/** POST /consumables/:ingredientId/sales — sell a FOH consumable directly (auto 1:1 link). */
export async function handleRecordConsumableSale(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    const body = parseSaleRequest(req, res);
    if (!body) return;
    const result = await recordConsumableSale(scope.organisationId, scope.userId, { ingredientId: req.params.ingredientId as string, ...body, actor: req.user! });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /sales/import/preview — match a CSV to menu items (deplete nothing). */
export async function handleSalesCsvPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    const file = req.file;
    if (!file) { invalid(res, "CSV file required"); return; }
    res.json(await previewSalesCsv(scope.organisationId, scope.userId, file.buffer.toString("utf-8")));
  } catch (err) {
    next(err);
  }
}

/** POST /sales/import/commit — record matched CSV rows (per-row atomic). */
export async function handleSalesCsvCommit(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await saleScope(req);
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      invalid(res, "lines must be a non-empty array");
      return;
    }
    res.json(await commitSalesCsv(scope.organisationId, scope.userId, lines, req.user!));
  } catch (err) {
    next(err);
  }
}

const menuItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price"),
  servings: z.number().int().min(1).max(999).optional().default(1),
  servingsPerSale: z.number().int().min(1).max(999).optional().default(1),
  qFactorPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0"),
});

const ingredientSchema = z.object({
  /** Catalog FK — Phase 1 catalog spine. Null/undefined for legacy free-text rows. */
  ingredientId: z.string().uuid().nullable().optional(),
  ingredientName: z.string().min(1).max(200),
  /** Narrative carried over from a recipe import or chef notes. Stored separately. */
  note: z.string().max(500).nullable().optional(),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "Invalid quantity"),
  unit: z.string().min(1).max(20),
  /** Optional manual override per dish. When omitted, cost flows from the linked
   *  ingredient's preferred_unit_cost (or org default if unlinked). */
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/, "Invalid cost").optional(),
  yieldPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

// ── Menu Items ───────────────────────────────────────────

export async function handleListMenuItems(req: Request, res: Response, next: NextFunction) {
  try {
    const category = req.query.category as string | undefined;
    const storeLocationId = req.query.storeLocationId as string | undefined;
    if (storeLocationId) await assertLocationAccess(req.user!, storeLocationId);
    res.json(await getMenuItems(await menuScope(req), category, storeLocationId));
  } catch (err) { next(err); }
}

export async function handleCreateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = menuItemSchema.safeParse(req.body);
    if (!parsed.success) { invalid(res, parsed.error.issues[0].message); return; }
    const item = await createMenuItem(await menuScope(req), parsed.data);
    res.status(201).json(item);
  } catch (err) { next(err); }
}

const updateMenuItemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(50).optional(),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price").optional(),
  servings: z.number().int().min(1).max(999).optional(),
  servingsPerSale: z.number().int().min(1).max(999).optional(),
  qFactorPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  unitsSold: z.number().int().min(0).optional(),
});

export async function handleUpdateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const parsed = updateMenuItemSchema.safeParse(req.body);
    if (!parsed.success) { invalid(res, parsed.error.issues[0].message); return; }
    const scope = await menuScope(req);
    await updateMenuItem(id, scope, parsed.data);
    res.json(await requireMenuItem(id, scope));
  } catch (err) { next(err); }
}

export async function handleDeleteMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteMenuItem(req.params.id as string, await menuScope(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Ingredients ──────────────────────────────────────────

export async function handleAddIngredient(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = ingredientSchema.safeParse(req.body);
    if (!parsed.success) { invalid(res, parsed.error.issues[0].message); return; }
    const menuItemId = req.params.id as string;
    await requireManageableMenuItem(menuItemId, await menuScope(req));
    const ing = await addIngredient(menuItemId, parsed.data);
    res.status(201).json(ing);
  } catch (err) { next(err); }
}

export async function handleListIngredients(req: Request, res: Response, next: NextFunction) {
  try {
    const menuItemId = req.params.id as string;
    await requireMenuItem(menuItemId, await menuScope(req));
    res.json(await getIngredients(menuItemId));
  } catch (err) { next(err); }
}

export async function handleDeleteIngredient(req: Request, res: Response, next: NextFunction) {
  try {
    const menuItemId = req.params.id as string;
    await requireManageableMenuItem(menuItemId, await menuScope(req));
    await deleteIngredient(parseInt(req.params.ingredientId as string, 10), menuItemId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/**
 * Catalog-spine Phase 3: refresh a menu_item_ingredient row's cost from the
 * Catalog. Clears the stale-cost flag.
 *
 * POST /api/menu/items/:id/ingredients/:ingredientId/refresh-cost
 */
export async function handleRefreshCost(req: Request, res: Response, next: NextFunction) {
  try {
    const menuItemId = req.params.id as string;
    await requireManageableMenuItem(menuItemId, await menuScope(req));
    const rowId = parseInt(req.params.ingredientId as string, 10);
    const updated = await refreshIngredientCost(rowId, menuItemId);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof AppError) && msg.includes("not found")) {
      res.status(404).json({ error: msg, code: "NOT_FOUND" });
      return;
    }
    if (!(err instanceof AppError) && msg.includes("unlinked")) {
      invalid(res, msg);
      return;
    }
    next(err);
  }
}

/**
 * Catalog-spine Phase 3: P&L view food cost for a menu item — uses
 * per-location WAC instead of the daily preferred-supplier cost.
 *
 * GET /api/menu/items/:id/pandl-cost
 */
export async function handleGetPandLCost(req: Request, res: Response, next: NextFunction) {
  try {
    const menuItemId = req.params.id as string;
    await requireMenuItem(menuItemId, await menuScope(req));
    const total = await getPandLFoodCost(menuItemId);
    res.json({ menuItemId, foodCost: total });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof AppError) && msg.includes("not found")) {
      res.status(404).json({ error: msg, code: "NOT_FOUND" });
      return;
    }
    next(err);
  }
}

// ── Analysis ─────────────────────────────────────────────

/** GET /api/menu/analysis — computed from what is stored; writes nothing. */
export async function handleGetAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    const category = req.query.category as string | undefined;
    res.json(await getMenuAnalysis(await menuScope(req), category));
  } catch (err) { next(err); }
}

export async function handleRecalculate(req: Request, res: Response, next: NextFunction) {
  try {
    const category = req.body?.category as string | undefined;
    await recalculateMenu(await menuScope(req), category);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Categories ───────────────────────────────────────────

export async function handleGetCategories(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getCategorySettings(await menuScope(req)));
  } catch (err) { next(err); }
}

export async function handleUpdateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const categoryName = req.params.name as string;
    const { targetFoodCostPct } = req.body;
    if (!targetFoodCostPct) { invalid(res, "targetFoodCostPct required"); return; }
    await upsertCategorySetting(await menuScope(req), categoryName, targetFoodCostPct);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── CSV Import ───────────────────────────────────────────

export async function handleImportSales(req: Request, res: Response, next: NextFunction) {
  try {
    const file = req.file;
    if (!file) { invalid(res, "CSV file required"); return; }
    const csvContent = file.buffer.toString("utf-8");
    res.json(await importCsvSalesData(await menuScope(req), csvContent));
  } catch (err) { next(err); }
}

// ── AI Recommendations ───────────────────────────────────

export async function handleGetRecommendations(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    res.json(await getItemRecommendations(id, await menuScope(req)));
  } catch (err) { next(err); }
}

// ── Waste Impact ─────────────────────────────────────────

export async function handleGetWasteImpact(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getWasteImpactForMenuItems(await menuScope(req)));
  } catch (err) { next(err); }
}

export async function handleGenerateReplacement(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await requireMenuItem(req.params.id as string, await menuScope(req));
    res.json(generateReplacementContext(item));
  } catch (err) { next(err); }
}

// ── Phase 4a: Yield Variance ─────────────────────────────

/**
 * GET /api/menu/items/:id/yield-variance — theoretical vs actual food cost
 * for a single dish over its sales-import period.
 */
export async function handleGetYieldVariance(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    await requireMenuItem(id, await menuScope(req));
    res.json(await getYieldVariance(id));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Menu item not found") {
      res.status(404).json({ error: msg, code: "NOT_FOUND" });
      return;
    }
    next(err);
  }
}

/**
 * GET /api/menu/yield-variance — bulk variance for every menu item of the
 * caller's organisation. Used by the Menu Intelligence list view.
 */
export async function handleListYieldVariance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listYieldVariance(await menuScope(req)));
  } catch (err) { next(err); }
}
