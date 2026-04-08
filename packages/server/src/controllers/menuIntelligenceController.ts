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
  getMenuAnalysis,
  recalculateMenu,
  getCategorySettings,
  upsertCategorySetting,
  importCsvSalesData,
  getItemRecommendations,
  generateReplacementContext,
  getWasteImpactForMenuItems,
} from "../services/menuIntelligenceService.js";

const menuItemSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price"),
});

const ingredientSchema = z.object({
  ingredientName: z.string().min(1).max(200),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "Invalid quantity"),
  unit: z.string().min(1).max(20),
  unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid cost"),
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
