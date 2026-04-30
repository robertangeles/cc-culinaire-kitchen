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
import { getMiseEnPlace } from "../services/misePlaceService.js";

const menuItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price"),
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
  unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid cost").optional(),
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

export async function handleUpdateMenuItem(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const id = req.params.id as string;
    await updateMenuItem(id, userId, req.body);
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
    const parsed = ingredientSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
    const ing = await addIngredient(req.params.id as string, parsed.data);
    res.status(201).json(ing);
  } catch (err) { next(err); }
}

export async function handleListIngredients(req: Request, res: Response, next: NextFunction) {
  try {
    const ingredients = await getIngredients(req.params.id as string);
    res.json(ingredients);
  } catch (err) { next(err); }
}

export async function handleDeleteIngredient(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteIngredient(parseInt(req.params.ingredientId as string, 10), req.params.id as string);
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
    const rowId = parseInt(req.params.ingredientId as string, 10);
    const updated = await refreshIngredientCost(rowId, req.params.id as string);
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
    const total = await getPandLFoodCost(req.params.id as string);
    res.json({ menuItemId: req.params.id, foodCost: total });
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

// ── Phase 4b: Mise en Place Rollup ────────────────────────

const miseQuerySchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "serviceDate must be YYYY-MM-DD"),
  coversForecast: z.coerce.number().int().min(1).max(100000),
  storeLocationId: z.string().uuid().optional(),
});

/**
 * GET /api/menu/mise-en-place?serviceDate=YYYY-MM-DD&coversForecast=N[&storeLocationId=...]
 *
 * Returns a station-grouped prep sheet scaled to the forecast.
 */
export async function handleGetMiseEnPlace(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const parsed = miseQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { serviceDate, coversForecast, storeLocationId } = parsed.data;
    const result = await getMiseEnPlace(
      userId,
      storeLocationId ?? null,
      serviceDate,
      coversForecast,
    );
    res.json(result);
  } catch (err) { next(err); }
}
