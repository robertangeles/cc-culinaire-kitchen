/**
 * @module services/autoPoSuggestService
 *
 * Catalog-spine Phase 4c: auto-PO suggestion table (basic, no approval flow).
 *
 * Given a location, surface ingredients whose current stock is at or below
 * par level, grouped by their preferred supplier so a buyer can scan the
 * page and decide which supplier to call. No PO is created automatically;
 * this is a static reorder list.
 *
 * Reorder qty rule:
 *   shortfall = par_level - current_qty            (ignored if ≤ 0)
 *   suggested = max(shortfall, reorder_qty ?? 0)   (use the larger of the
 *               two so we don't suggest a wasteful tiny order when reorder
 *               quantities are configured)
 *
 * Per-location overrides on `location_ingredient` win over org defaults
 * on `ingredient`.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export interface AutoPoLine {
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  baseUnit: string;
  currentQty: number;
  parLevel: number;
  reorderQty: number | null;
  shortfall: number;
  suggestedQty: number;
  preferredUnitCost: number | null;
  estimatedCost: number | null;
}

export interface AutoPoSupplierBlock {
  supplierId: string | null;
  supplierName: string;
  lines: AutoPoLine[];
  estimatedTotal: number;
}

export interface AutoPoResult {
  storeLocationId: string;
  generatedAt: string;
  suppliers: AutoPoSupplierBlock[];
  totalLines: number;
  totalEstimatedCost: number;
}

interface AutoPoRow extends Record<string, unknown> {
  ingredient_id: string;
  ingredient_name: string;
  ingredient_category: string;
  base_unit: string;
  current_qty: string | null;
  par_level: string | null;
  reorder_qty: string | null;
  preferred_unit_cost: string | null;
  preferred_supplier_id: string | null;
  supplier_name: string | null;
}

export async function getAutoPoSuggestions(
  storeLocationId: string,
): Promise<AutoPoResult> {
  // One query: stock_level (current) ⊕ location_ingredient (par/reorder
  // override) ⊕ ingredient (org defaults + preferred supplier denorm).
  // Filter to rows where current_qty ≤ effective par_level.
  const rows = await db.execute<AutoPoRow>(sql`
    SELECT
      i.ingredient_id,
      i.ingredient_name,
      i.ingredient_category,
      i.base_unit,
      sl.current_qty,
      COALESCE(li.par_level, i.par_level) AS par_level,
      COALESCE(li.reorder_qty, i.reorder_qty) AS reorder_qty,
      i.preferred_unit_cost,
      i.preferred_supplier_id,
      s.supplier_name
    FROM ingredient i
    LEFT JOIN stock_level sl
      ON sl.ingredient_id = i.ingredient_id
      AND sl.store_location_id = ${storeLocationId}::uuid
    LEFT JOIN location_ingredient li
      ON li.ingredient_id = i.ingredient_id
      AND li.store_location_id = ${storeLocationId}::uuid
    LEFT JOIN supplier s ON s.supplier_id = i.preferred_supplier_id
    WHERE i.deleted_at IS NULL
      AND COALESCE(li.par_level, i.par_level) IS NOT NULL
      AND COALESCE(li.par_level, i.par_level)::numeric > COALESCE(sl.current_qty, 0)::numeric
      AND (li.active_ind IS NULL OR li.active_ind = TRUE)
  `);

  if (rows.length === 0) {
    return {
      storeLocationId,
      generatedAt: new Date().toISOString(),
      suppliers: [],
      totalLines: 0,
      totalEstimatedCost: 0,
    };
  }

  // Group by preferred supplier; rows without a supplier go under
  // "Unassigned" so the buyer can pick one.
  const supplierMap = new Map<string, AutoPoSupplierBlock>();
  let totalEstimatedCost = 0;

  for (const r of rows) {
    const currentQty = parseFloat(r.current_qty ?? "0") || 0;
    const parLevel = parseFloat(r.par_level ?? "0") || 0;
    const reorderQty = r.reorder_qty != null ? parseFloat(r.reorder_qty) : null;
    const shortfall = Math.max(parLevel - currentQty, 0);

    if (shortfall <= 0) continue; // belt + braces; the WHERE already filtered

    const suggestedQty = Math.max(shortfall, reorderQty ?? 0);
    const preferredUnitCost =
      r.preferred_unit_cost != null ? parseFloat(r.preferred_unit_cost) : null;
    const estimatedCost =
      preferredUnitCost != null ? Number((suggestedQty * preferredUnitCost).toFixed(2)) : null;

    const supplierKey = r.preferred_supplier_id ?? "__unassigned__";
    const supplierName = r.supplier_name ?? "Unassigned";

    const block = supplierMap.get(supplierKey) ?? {
      supplierId: r.preferred_supplier_id,
      supplierName,
      lines: [],
      estimatedTotal: 0,
    };

    block.lines.push({
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      category: r.ingredient_category,
      baseUnit: r.base_unit,
      currentQty,
      parLevel,
      reorderQty,
      shortfall: Number(shortfall.toFixed(3)),
      suggestedQty: Number(suggestedQty.toFixed(3)),
      preferredUnitCost,
      estimatedCost,
    });

    if (estimatedCost != null) {
      block.estimatedTotal = Number((block.estimatedTotal + estimatedCost).toFixed(2));
      totalEstimatedCost = Number((totalEstimatedCost + estimatedCost).toFixed(2));
    }

    supplierMap.set(supplierKey, block);
  }

  // Sort suppliers — "Unassigned" pinned last; others alphabetical.
  const suppliers = Array.from(supplierMap.values()).sort((a, b) => {
    if (a.supplierName === "Unassigned") return 1;
    if (b.supplierName === "Unassigned") return -1;
    return a.supplierName.localeCompare(b.supplierName);
  });

  // Sort lines within each block by ingredient name.
  for (const s of suppliers) {
    s.lines.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));
  }

  const totalLines = suppliers.reduce((n, s) => n + s.lines.length, 0);

  return {
    storeLocationId,
    generatedAt: new Date().toISOString(),
    suppliers,
    totalLines,
    totalEstimatedCost,
  };
}
