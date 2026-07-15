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
  getMenuItem,
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
import { recordSale, voidSale, listSales, previewSalesCsv, commitSalesCsv, listSellableConsumables, recordConsumableSale, SaleError } from "../services/saleService.js";
import { getUserLocationContext } from "../services/locationContextService.js";

/** Resolve the caller's org id from their location context. */
async function resolveSalesOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext((req as any).user.sub);
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return orgId;
}

/** Map a SaleError to its status; otherwise bubble to the error handler. */
function handleSaleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof SaleError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err as Error);
}

/** POST /items/:id/sales — record a menu-item sale (recipe → stock depletion). */
export async function handleRecordSale(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    const userId = (req as any).user.sub;
    const { qtySold, soldAt, locationId } = req.body ?? {};
    if (qtySold === undefined || Number(qtySold) <= 0) {
      res.status(400).json({ error: "qtySold must be greater than 0" });
      return;
    }
    const idempotencyKey = (req.header("Idempotency-Key") as string | undefined) ?? undefined;
    const result = await recordSale(orgId, userId, {
      menuItemId: req.params.id as string,
      qtySold: Number(qtySold),
      soldAt: soldAt ? new Date(String(soldAt)) : undefined,
      locationId: locationId || undefined,
      idempotencyKey,
    });
    res.status(201).json(result);
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** POST /sales/:saleId/void — reverse a recorded sale. */
export async function handleVoidSale(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    const result = await voidSale(orgId, (req as any).user.sub, req.params.saleId as string);
    res.json(result);
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** GET /locations/:locId/sales — recent sales for a location. */
export async function handleListSales(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listSales(orgId, req.params.locId as string, limit));
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** GET /consumables — sellable FOH consumables for the Record-sale picker. */
export async function handleListConsumables(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    res.json(await listSellableConsumables(orgId));
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** POST /consumables/:ingredientId/sales — sell a FOH consumable directly (auto 1:1 link). */
export async function handleRecordConsumableSale(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    const userId = (req as any).user.sub;
    const { qtySold, soldAt, locationId } = req.body ?? {};
    if (qtySold === undefined || Number(qtySold) <= 0) {
      res.status(400).json({ error: "qtySold must be greater than 0" });
      return;
    }
    const idempotencyKey = (req.header("Idempotency-Key") as string | undefined) ?? undefined;
    const result = await recordConsumableSale(orgId, userId, {
      ingredientId: req.params.ingredientId as string,
      qtySold: Number(qtySold),
      soldAt: soldAt ? new Date(String(soldAt)) : undefined,
      locationId: locationId || undefined,
      idempotencyKey,
    });
    res.status(201).json(result);
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** POST /sales/import/preview — match a CSV to menu items (deplete nothing). */
export async function handleSalesCsvPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const file = req.file;
    if (!file) { res.status(400).json({ error: "CSV file required" }); return; }
    res.json(await previewSalesCsv(userId, file.buffer.toString("utf-8")));
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

/** POST /sales/import/commit — record matched CSV rows (per-row atomic). */
export async function handleSalesCsvCommit(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveSalesOrgId(req, res);
    if (orgId === null) return;
    const userId = (req as any).user.sub;
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines must be a non-empty array" });
      return;
    }
    res.json(await commitSalesCsv(orgId, userId, lines));
  } catch (err) {
    handleSaleError(err, res, next);
  }
}

const menuItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price"),
  servings: z.number().int().min(1).max(999).optional().default(1),
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
    const userId = (req as any).user.sub;
    const category = req.query.category as string | undefined;
    const storeLocationId = req.query.storeLocationId as string | undefined;
    const items = await getMenuItems(userId, category, storeLocationId);
    res.json(items);
  } catch (err) { next(err); }
}

export async function handleCreateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const parsed = menuItemSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
    const item = await createMenuItem(userId, parsed.data);
    res.status(201).json(item);
  } catch (err) { next(err); }
}

const updateMenuItemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(50).optional(),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price").optional(),
  servings: z.number().int().min(1).max(999).optional(),
  qFactorPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  unitsSold: z.number().int().min(0).optional(),
});

export async function handleUpdateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    const parsed = updateMenuItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    await updateMenuItem(id, userId, parsed.data);
    const item = await getMenuItem(id, userId);
    res.json(item);
  } catch (err) { next(err); }
}

export async function handleDeleteMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    await deleteMenuItem(req.params.id as string, userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Ingredients ──────────────────────────────────────────

export async function handleAddIngredient(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const parsed = ingredientSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
    const menuItemId = req.params.id as string;
    const item = await getMenuItem(menuItemId, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const ing = await addIngredient(menuItemId, parsed.data);
    res.status(201).json(ing);
  } catch (err) { next(err); }
}

export async function handleListIngredients(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const menuItemId = req.params.id as string;
    const item = await getMenuItem(menuItemId, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const ingredients = await getIngredients(menuItemId);
    res.json(ingredients);
  } catch (err) { next(err); }
}

export async function handleDeleteIngredient(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const menuItemId = req.params.id as string;
    const item = await getMenuItem(menuItemId, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
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
    const userId = (req as any).user.sub;
    const menuItemId = req.params.id as string;
    const item = await getMenuItem(menuItemId, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const rowId = parseInt(req.params.ingredientId as string, 10);
    const updated = await refreshIngredientCost(rowId, menuItemId);
    res.json(updated);
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message?.includes("unlinked")) {
      res.status(400).json({ error: err.message });
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
    const userId = (req as any).user.sub;
    const menuItemId = req.params.id as string;
    const item = await getMenuItem(menuItemId, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const total = await getPandLFoodCost(menuItemId);
    res.json({ menuItemId, foodCost: total });
  } catch (err: any) {
    if (err.message?.includes("not found")) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ── Analysis ─────────────────────────────────────────────

export async function handleGetAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const category = req.query.category as string | undefined;
    const analysis = await getMenuAnalysis(userId, category);
    res.json(analysis);
  } catch (err) { next(err); }
}

export async function handleRecalculate(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const category = req.body.category as string | undefined;
    await recalculateMenu(userId, category);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── Categories ───────────────────────────────────────────

export async function handleGetCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const settings = await getCategorySettings(userId);
    res.json(settings);
  } catch (err) { next(err); }
}

export async function handleUpdateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const categoryName = req.params.name as string;
    const { targetFoodCostPct } = req.body;
    if (!targetFoodCostPct) { res.status(400).json({ error: "targetFoodCostPct required" }); return; }
    await upsertCategorySetting(userId, categoryName, targetFoodCostPct);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ── CSV Import ───────────────────────────────────────────

export async function handleImportSales(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const file = req.file;
    if (!file) { res.status(400).json({ error: "CSV file required" }); return; }
    const csvContent = file.buffer.toString("utf-8");
    const result = await importCsvSalesData(userId, csvContent);
    res.json(result);
  } catch (err) { next(err); }
}

// ── AI Recommendations ───────────────────────────────────

export async function handleGetRecommendations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    const recommendations = await getItemRecommendations(id, userId);
    res.json(recommendations);
  } catch (err) { next(err); }
}

// ── Waste Impact ─────────────────────────────────────────

export async function handleGetWasteImpact(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const impacts = await getWasteImpactForMenuItems(userId);
    res.json(impacts);
  } catch (err) { next(err); }
}

export async function handleGenerateReplacement(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    const item = await getMenuItem(id, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const context = generateReplacementContext(item);
    res.json(context);
  } catch (err) { next(err); }
}

// ── Phase 4a: Yield Variance ─────────────────────────────

/**
 * GET /api/menu/items/:id/yield-variance — theoretical vs actual food cost
 * for a single dish over its sales-import period.
 */
export async function handleGetYieldVariance(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    const item = await getMenuItem(id, userId);
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    const result = await getYieldVariance(id);
    res.json(result);
  } catch (err: any) {
    if (err.message === "Menu item not found") {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/**
 * GET /api/menu/yield-variance — bulk variance for every menu item the
 * caller owns. Used by the Menu Intelligence list view.
 */
export async function handleListYieldVariance(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const results = await listYieldVariance(userId);
    res.json(results);
  } catch (err) { next(err); }
}


