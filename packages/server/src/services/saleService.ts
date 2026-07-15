/**
 * @module services/saleService
 *
 * Recipe-based selling. A sale is a MENU-ITEM event: recording a sale explodes
 * the menu item's recipe and deducts each ingredient from stock (unit-converted
 * to the ingredient's base unit), writing one `consumption_log` row per
 * ingredient tagged with the sale + menu item. That is exactly what
 * `yieldVarianceService` reads, so selling feeds theoretical-vs-actual variance.
 *
 * Design decisions (see the plan): D1 preflight-then-commit (a bad stock-linked
 * line aborts the whole sale, deplete nothing; free-text lines skip with a
 * warning), D2 one-level prep expansion (throws on nested prep), D5 per-sale
 * location resolution, D6 yield clamp, D7 reversible via the `sale` header +
 * voidSale, D11 layered scoping (own the menu item AND org-match the stock),
 * D13 idempotency key. Costing stays WAC (D4) — deductStock only, no FIFO.
 */

import { createHash } from "node:crypto";
import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import {
  menuItem,
  menuItemIngredient,
  prepComponentIngredient,
  ingredient,
  storeLocation,
  stockLevel,
  consumptionLog,
  sale,
} from "../db/schema.js";
import { resolveToBase } from "./unitConversionService.js";

export class SaleError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "SaleError";
  }
}

export interface RecordSaleInput {
  menuItemId: string;
  qtySold: number;
  source?: "MANUAL" | "CSV" | "POS";
  soldAt?: Date;
  locationId?: string;
  idempotencyKey?: string | null;
}

interface DepletionLine {
  ingredientId: string;
  ingredientName: string;
  baseQty: number;
  baseUnit: string;
}

export interface RecordSaleResult {
  saleId: string;
  alreadyExists?: boolean;
  voided?: boolean;
  depleted: Array<{ ingredientId: string; ingredientName: string; baseQty: number; baseUnit: string; fohOnHand: number; oversold: boolean }>;
  skipped: Array<{ ingredientName: string; reason: string }>;
  oversold: string[];
}

/** yield% → gross-up divisor, clamped (D6): 0/null/negative ⇒ 100% (no gross-up). */
function yieldFactor(yieldPct: unknown): number {
  const y = Number(yieldPct);
  return y > 0 ? y / 100 : 1;
}

/**
 * Resolve the location for a sale (D5): explicit arg → menu item's location →
 * the org's sole location → else reject.
 */
async function resolveSaleLocation(
  orgId: number,
  explicit: string | undefined,
  menuItemLocation: string | null,
): Promise<string> {
  const candidate = explicit ?? menuItemLocation ?? null;
  if (candidate) {
    const [loc] = await db
      .select({ id: storeLocation.storeLocationId })
      .from(storeLocation)
      .where(and(eq(storeLocation.storeLocationId, candidate), eq(storeLocation.organisationId, orgId)));
    if (!loc) throw new SaleError("Location not found in this organisation", 404);
    return candidate;
  }
  const locs = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(eq(storeLocation.organisationId, orgId));
  if (locs.length === 1) return locs[0].id;
  throw new SaleError("Choose a location for this sale", 400);
}

/**
 * Preflight (no writes): resolve every stock-linked recipe line to a base-unit
 * depletion. Throws (abort whole sale) if any stock-linked line can't resolve
 * or is cross-org. Free-text lines are returned as skipped warnings.
 */
async function planDepletions(
  orgId: number,
  menuItemId: string,
  servings: number,
  qtySold: number,
): Promise<{ depletions: DepletionLine[]; skipped: Array<{ ingredientName: string; reason: string }> }> {
  const lines = await db
    .select()
    .from(menuItemIngredient)
    .where(eq(menuItemIngredient.menuItemId, menuItemId));

  const depletions: DepletionLine[] = [];
  const skipped: Array<{ ingredientName: string; reason: string }> = [];
  const perServing = servings > 0 ? servings : 1;

  const assertOrg = async (ingredientId: string, name: string) => {
    const [ing] = await db
      .select({ orgId: ingredient.organisationId })
      .from(ingredient)
      .where(eq(ingredient.ingredientId, ingredientId));
    if (!ing) throw new SaleError(`Ingredient not found: ${name}`, 404);
    if (ing.orgId !== orgId) throw new SaleError(`Ingredient "${name}" is not in this organisation`, 403);
  };

  for (const line of lines) {
    // Prep sub-recipe line — expand ONE level into its raw ingredients (D2).
    if (line.prepComponentId) {
      const prepLines = await db
        .select()
        .from(prepComponentIngredient)
        .where(eq(prepComponentIngredient.prepComponentId, line.prepComponentId));
      const dishUses = Number(line.quantity) / yieldFactor(line.yieldPct);
      for (const pl of prepLines) {
        // D2: prep_component_ingredient references only RAW ingredients (no
        // prep-in-prep column), so one level is exhaustive. A prep line must
        // resolve to a raw ingredient or be skipped as free-text.
        if (!pl.ingredientId) {
          skipped.push({ ingredientName: pl.ingredientName, reason: "prep line has no linked ingredient" });
          continue;
        }
        await assertOrg(pl.ingredientId, pl.ingredientName);
        // raw used = (dish's prep usage) × (prep raw qty), yield-adjusted, per serving.
        const rawEntered = (dishUses * Number(pl.quantity)) / yieldFactor(pl.yieldPct) / perServing * qtySold;
        const { baseQty, baseUnit } = await resolveToBase(pl.ingredientId, rawEntered, pl.unit);
        depletions.push({ ingredientId: pl.ingredientId, ingredientName: pl.ingredientName, baseQty, baseUnit });
      }
      continue;
    }

    // Legacy free-text line — cannot deplete (D1).
    if (!line.ingredientId) {
      skipped.push({ ingredientName: line.ingredientName, reason: "no linked ingredient (free-text line)" });
      continue;
    }

    await assertOrg(line.ingredientId, line.ingredientName);
    // per-serving, yield-adjusted, × qty sold. resolveToBase throws → aborts.
    const entered = Number(line.quantity) / yieldFactor(line.yieldPct) / perServing * qtySold;
    const { baseQty, baseUnit } = await resolveToBase(line.ingredientId, entered, line.unit);
    depletions.push({ ingredientId: line.ingredientId, ingredientName: line.ingredientName, baseQty, baseUnit });
  }

  return { depletions, skipped };
}

/** Deduct base qty from stock, locking the row; inserts a negative row if none exists (oversell allowed). Returns the new on-hand. */
async function deductForSale(tx: DbOrTx, locationId: string, ingredientId: string, baseQty: number): Promise<number> {
  const [row] = await tx
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, locationId), eq(stockLevel.ingredientId, ingredientId)))
    .for("update");
  if (!row) {
    const newQty = -baseQty;
    await tx.insert(stockLevel).values({ storeLocationId: locationId, ingredientId, currentQty: String(newQty), version: 0 });
    return newQty;
  }
  const newQty = Number(row.currentQty) - baseQty;
  await tx
    .update(stockLevel)
    .set({ currentQty: String(newQty), version: row.version + 1, updatedDttm: new Date() })
    .where(eq(stockLevel.stockLevelId, row.stockLevelId));
  return newQty;
}

/**
 * Record a menu-item sale: preflight the recipe, then (in one transaction) write
 * the sale header, bump units_sold, and deplete every ingredient + log it.
 */
export async function recordSale(orgId: number, userId: number, input: RecordSaleInput): Promise<RecordSaleResult> {
  if (!(input.qtySold > 0)) throw new SaleError("qtySold must be greater than 0", 400);
  const soldAt = input.soldAt ?? new Date();
  if (soldAt.getTime() > Date.now() + 60_000) throw new SaleError("soldAt cannot be in the future", 400);
  const source = input.source ?? "MANUAL";

  // Idempotency (D13): a replayed key returns the existing sale, no re-record.
  if (input.idempotencyKey) {
    const [existing] = await db
      .select({ saleId: sale.saleId, voidedAt: sale.voidedAt })
      .from(sale)
      .where(and(eq(sale.organisationId, orgId), eq(sale.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      return { saleId: existing.saleId, alreadyExists: true, voided: existing.voidedAt != null, depleted: [], skipped: [], oversold: [] };
    }
  }

  // Load the menu item, enforcing user ownership (D11a).
  const [mi] = await db
    .select()
    .from(menuItem)
    .where(and(eq(menuItem.menuItemId, input.menuItemId), eq(menuItem.userId, userId)));
  if (!mi) throw new SaleError("Menu item not found", 404);

  const locationId = await resolveSaleLocation(orgId, input.locationId, mi.storeLocationId);

  // Preflight — resolve all depletions (D1). Throws before any write.
  const { depletions, skipped } = await planDepletions(orgId, input.menuItemId, mi.servings, input.qtySold);

  // Commit: sale header + units_sold + depletions + logs, one transaction.
  return db.transaction(async (tx) => {
    const [saleRow] = await tx
      .insert(sale)
      .values({
        organisationId: orgId,
        menuItemId: input.menuItemId,
        storeLocationId: locationId,
        qtySold: String(input.qtySold),
        source,
        idempotencyKey: input.idempotencyKey ?? null,
        soldAt,
        createdBy: userId,
      })
      .returning();

    await tx
      .update(menuItem)
      .set({ unitsSold: sql`${menuItem.unitsSold} + ${input.qtySold}`, updatedDttm: new Date() })
      .where(eq(menuItem.menuItemId, input.menuItemId));

    const depleted: RecordSaleResult["depleted"] = [];
    const oversold: string[] = [];
    for (const d of depletions) {
      const newQty = await deductForSale(tx, locationId, d.ingredientId, d.baseQty);
      const isOversold = newQty < 0;
      if (isOversold) oversold.push(d.ingredientName);
      await tx.insert(consumptionLog).values({
        organisationId: orgId,
        storeLocationId: locationId,
        ingredientId: d.ingredientId,
        menuItemId: input.menuItemId,
        saleId: saleRow.saleId,
        userId,
        quantity: String(d.baseQty),
        unit: d.baseUnit,
        baseQty: String(d.baseQty), // already resolved to the kitchen unit
        reason: "sale",
        loggedAt: soldAt,
      });
      depleted.push({ ingredientId: d.ingredientId, ingredientName: d.ingredientName, baseQty: d.baseQty, baseUnit: d.baseUnit, fohOnHand: newQty, oversold: isOversold });
    }

    return { saleId: saleRow.saleId, depleted, skipped, oversold };
  });
}

/**
 * Reverse a sale (D7): restore every ingredient this sale depleted and
 * decrement units_sold. Guarded against double-void (409).
 */
export async function voidSale(orgId: number, userId: number, saleId: string): Promise<{ saleId: string; restored: number }> {
  const [saleRow] = await db
    .select()
    .from(sale)
    .where(and(eq(sale.saleId, saleId), eq(sale.organisationId, orgId)));
  if (!saleRow) throw new SaleError("Sale not found", 404);
  if (saleRow.voidedAt) throw new SaleError("Sale is already voided", 409);

  const rows = await db
    .select()
    .from(consumptionLog)
    .where(eq(consumptionLog.saleId, saleId));

  return db.transaction(async (tx) => {
    for (const r of rows) {
      // Add the depleted qty back (rows store base qty already).
      const [sl] = await tx
        .select()
        .from(stockLevel)
        .where(and(eq(stockLevel.storeLocationId, r.storeLocationId), eq(stockLevel.ingredientId, r.ingredientId)))
        .for("update");
      const back = Number(r.quantity);
      if (!sl) {
        await tx.insert(stockLevel).values({ storeLocationId: r.storeLocationId, ingredientId: r.ingredientId, currentQty: String(back), version: 0 });
      } else {
        await tx
          .update(stockLevel)
          .set({ currentQty: String(Number(sl.currentQty) + back), version: sl.version + 1, updatedDttm: new Date() })
          .where(eq(stockLevel.stockLevelId, sl.stockLevelId));
      }
    }
    await tx
      .update(menuItem)
      .set({ unitsSold: sql`GREATEST(0, ${menuItem.unitsSold} - ${Number(saleRow.qtySold)})`, updatedDttm: new Date() })
      .where(eq(menuItem.menuItemId, saleRow.menuItemId));
    await tx
      .update(sale)
      .set({ voidedAt: new Date(), voidedBy: userId })
      .where(eq(sale.saleId, saleId));
    return { saleId, restored: rows.length };
  });
}

// ─── FOH direct sale (auto 1:1 link) ───────────────────────────────────────

/**
 * List the org's sellable FOH consumables (for the Record-sale picker).
 * Op supplies are never sellable; kitchen ingredients sell via real menu items.
 */
export function listSellableConsumables(orgId: number) {
  return db
    .select({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
    })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.organisationId, orgId),
        eq(ingredient.itemType, "FOH_CONSUMABLE"),
        sql`${ingredient.deletedAt} IS NULL`,
      ),
    )
    .orderBy(ingredient.ingredientName);
}

/**
 * Get (or create, once) the hidden 1:1 sale link for a FOH consumable: a
 * system-generated menu item whose recipe is "1 kitchen unit of the item".
 * The operator never builds recipe math for a can — they just sell it.
 * Race-safe via the partial unique (user_id, linked_ingredient_id).
 */
async function getOrCreateConsumableLink(orgId: number, userId: number, ingredientId: string): Promise<string> {
  const [ing] = await db
    .select()
    .from(ingredient)
    .where(and(eq(ingredient.ingredientId, ingredientId), eq(ingredient.organisationId, orgId)));
  if (!ing) throw new SaleError("Item not found", 404);
  if (ing.itemType !== "FOH_CONSUMABLE") {
    throw new SaleError("Only FOH consumables can be sold directly", 400);
  }

  const [existing] = await db
    .select({ menuItemId: menuItem.menuItemId })
    .from(menuItem)
    .where(and(eq(menuItem.userId, userId), eq(menuItem.linkedIngredientId, ingredientId)));
  if (existing) return existing.menuItemId;

  try {
    return await db.transaction(async (tx) => {
      const [mi] = await tx
        .insert(menuItem)
        .values({
          userId,
          name: ing.ingredientName,
          category: "foh",
          sellingPrice: "0",
          servings: 1,
          linkedIngredientId: ingredientId,
        })
        .returning();
      await tx.insert(menuItemIngredient).values({
        menuItemId: mi.menuItemId,
        ingredientId,
        ingredientName: ing.ingredientName,
        quantity: "1",
        unit: ing.baseUnit,
        unitCost: ing.preferredUnitCost ?? ing.unitCost ?? "0",
        yieldPct: "100",
      });
      return mi.menuItemId;
    });
  } catch {
    // Lost the race to the partial unique — the link now exists; reuse it.
    const [again] = await db
      .select({ menuItemId: menuItem.menuItemId })
      .from(menuItem)
      .where(and(eq(menuItem.userId, userId), eq(menuItem.linkedIngredientId, ingredientId)));
    if (again) return again.menuItemId;
    throw new SaleError("Could not create the sale link for this item", 500);
  }
}

/** Sell a FOH consumable directly: sell 3 cans → stock drops 3. */
export async function recordConsumableSale(
  orgId: number,
  userId: number,
  input: { ingredientId: string; qtySold: number; soldAt?: Date; locationId?: string; idempotencyKey?: string | null },
): Promise<RecordSaleResult> {
  const menuItemId = await getOrCreateConsumableLink(orgId, userId, input.ingredientId);
  return recordSale(orgId, userId, {
    menuItemId,
    qtySold: input.qtySold,
    source: "MANUAL",
    soldAt: input.soldAt,
    locationId: input.locationId,
    idempotencyKey: input.idempotencyKey,
  });
}

// ─── CSV import (two-phase: preview → per-row-atomic commit) ──────────────

export interface CsvSaleLine {
  rowIndex: number;
  name: string;
  qtySold: number;
  soldAt?: string;
}

export interface CsvPreview {
  matched: Array<{ rowIndex: number; menuItemId: string; name: string; qtySold: number; soldAt?: string }>;
  unmatched: Array<{ rowIndex: number; name: string; reason: string }>;
}

/** Canonicalise a row into a stable idempotency key (D12/D13): content, not file position. */
function rowKey(menuItemId: string, qtySold: number, soldAt: string | undefined, occurrence: number): string {
  const canonical = [menuItemId.toLowerCase(), String(qtySold), soldAt ? new Date(soldAt).toISOString() : "", occurrence].join("|");
  return "csv:" + createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

/**
 * Phase 1 (D3): parse a sales CSV and match each row's name → menu_item_id for
 * this user. Deplete NOTHING. Rows are `name,qty[,soldAt]`; a header row and
 * blank rows are skipped. Unmatched/ambiguous names are reported, never dropped.
 */
export async function previewSalesCsv(userId: number, csvContent: string): Promise<CsvPreview> {
  const items = await db
    .select({ id: menuItem.menuItemId, name: menuItem.name })
    .from(menuItem)
    .where(eq(menuItem.userId, userId));
  const byName = new Map<string, string[]>();
  for (const it of items) {
    const k = it.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), it.id]);
  }

  const matched: CsvPreview["matched"] = [];
  const unmatched: CsvPreview["unmatched"] = [];
  const lines = csvContent.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const row = raw.trim();
    if (!row) return;
    const [c0, c1, c2] = row.split(",").map((c) => c.trim());
    if (!c0 || /^(item|menu|name|menu item)$/i.test(c0)) return; // header
    const qty = Number(c1);
    if (!(qty > 0)) {
      unmatched.push({ rowIndex: i, name: c0, reason: "invalid quantity" });
      return;
    }
    const ids = byName.get(c0.toLowerCase());
    if (!ids || ids.length === 0) {
      unmatched.push({ rowIndex: i, name: c0, reason: "no matching menu item" });
    } else if (ids.length > 1) {
      unmatched.push({ rowIndex: i, name: c0, reason: "ambiguous name (multiple menu items)" });
    } else {
      matched.push({ rowIndex: i, menuItemId: ids[0], name: c0, qtySold: qty, soldAt: c2 || undefined });
    }
  });

  return { matched, unmatched };
}

/**
 * Phase 2 (D12): commit matched rows. Each row is its OWN recordSale (per-row
 * atomic — a bad row never rolls back the others). A per-row content-derived
 * idempotency key makes re-importing the same file a no-op.
 */
export async function commitSalesCsv(orgId: number, userId: number, lines: CsvSaleLine[]) {
  const succeeded: Array<{ rowIndex: number; saleId: string }> = [];
  const alreadyExists: Array<{ rowIndex: number; saleId: string; voided: boolean }> = [];
  const failed: Array<{ rowIndex: number; reason: string }> = [];

  const occ = new Map<string, number>(); // content → occurrence counter within the file
  for (const line of lines) {
    const contentId = [line.name.toLowerCase(), line.qtySold, line.soldAt ?? ""].join("|");
    const n = (occ.get(contentId) ?? 0) + 1;
    occ.set(contentId, n);
    try {
      // Resolve name → menu item id again at commit (defends against a stale preview).
      const [mi] = await db
        .select({ id: menuItem.menuItemId })
        .from(menuItem)
        .where(and(eq(menuItem.userId, userId), sql`lower(${menuItem.name}) = ${line.name.toLowerCase()}`));
      if (!mi) {
        failed.push({ rowIndex: line.rowIndex, reason: "no matching menu item" });
        continue;
      }
      const key = rowKey(mi.id, line.qtySold, line.soldAt, n);
      const res = await recordSale(orgId, userId, {
        menuItemId: mi.id,
        qtySold: line.qtySold,
        source: "CSV",
        soldAt: line.soldAt ? new Date(line.soldAt) : undefined,
        idempotencyKey: key,
      });
      if (res.alreadyExists) alreadyExists.push({ rowIndex: line.rowIndex, saleId: res.saleId, voided: !!res.voided });
      else succeeded.push({ rowIndex: line.rowIndex, saleId: res.saleId });
    } catch (err) {
      failed.push({ rowIndex: line.rowIndex, reason: err instanceof Error ? err.message : "failed" });
    }
  }

  return { succeeded, alreadyExists, failed };
}

/** Recent (non-voided) sales for a location, newest first. */
export function listSales(orgId: number, locationId: string, limit = 100) {
  return db
    .select({
      saleId: sale.saleId,
      menuItemId: sale.menuItemId,
      menuItemName: menuItem.name,
      qtySold: sale.qtySold,
      source: sale.source,
      soldAt: sale.soldAt,
      voidedAt: sale.voidedAt,
    })
    .from(sale)
    .innerJoin(menuItem, eq(sale.menuItemId, menuItem.menuItemId))
    .where(and(eq(sale.organisationId, orgId), eq(sale.storeLocationId, locationId)))
    .orderBy(desc(sale.soldAt))
    .limit(limit);
}
