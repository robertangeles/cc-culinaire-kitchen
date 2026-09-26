/**
 * @module services/ingredientService
 *
 * Barrel re-export — Phase 2b split. All implementation lives in:
 *   ingredientCatalogService.ts — catalog CRUD, suppliers, unit conversions, ingredient-supplier links
 *   ingredientStockService.ts  — per-location config, activation, stock queries, transaction history
 *
 * Import from "ingredientService.js" for zero caller changes.
 */

export * from "./ingredientCatalogService.js";
export * from "./ingredientStockService.js";
