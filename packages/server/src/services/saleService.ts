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
 *
 * Wave 7: menu items belong to the organisation, so any member who may sell can sell any item of it (D11a
 * becomes "the item is in the caller's organisation"); the key is claimed by the insert itself (ON CONFLICT),
 * a replay with a different payload is a 409, stock leaves the zone its item type lives in (a FOH consumable
 * from the shelf, everything else from BOH) and the zone is kept on the consumption row for the void, and a sale
 * is only recorded or voided at a location the caller may use. Stock comes off where the seller is working: a sale
 * that names no location is recorded at the caller's selected one, not the menu item's.
 */

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql, desc } from "drizzle-orm";
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
import { assertLocationAccess, canAccessLocation, getUserLocationContext } from "./locationContextService.js";
import { menuReadable, type MenuScope } from "./menuAccess.js";
import { persistClassification } from "./menuIntelligenceService.js";
import type { TokenPayload } from "./authService.js";
import { AppError } from "../utils/appError.js";
import type { ServerErrorCode } from "@culinaire/shared";
import pino from "pino";

const logger = pino({ name: "saleService" });

const CODE_FOR_STATUS: Record<number, ServerErrorCode> = { 400: "VALIDATION", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "INVALID_STATE" };

/** A refused sale request. `{ error, code }` on the wire (errorHandler); the code defaults from the status. */
export class SaleError extends AppError {
  constructor(message: string, statusCode: number, code: ServerErrorCode = CODE_FOR_STATUS[statusCode] ?? "VALIDATION") {
    super(statusCode, code, message);
    this.name = "SaleError";
  }
}

/** The caller's side of a sale: who they are and the organisation it is recorded in. Reads need no admin flag. */
const readScope = (orgId: number, userId: number): MenuScope => ({ userId, organisationId: orgId, isOrgAdmin: false });

/** Which stock zone an item type lives in: the FOH shelf for a consumable, the back of house for everything else. */
const zoneFor = (itemType: string): "BOH" | "FOH" => (itemType === "FOH_CONSUMABLE" ? "FOH" : "BOH");

/** sale.qty_sold is numeric(10,3): a quantity with more decimals would be stored as a different number than the one sold. */
export const fitsSaleQty = (qty: number): boolean => qty < 1e7 && Number(qty.toFixed(3)) === qty;

export interface RecordSaleInput {
  menuItemId: string;
  qtySold: number;
  source?: "MANUAL" | "CSV" | "POS";
  soldAt?: Date;
  locationId?: string;
  idempotencyKey?: string | null;
  /** The signed-in caller; the location the sale resolves to must be one they can use. Omit only for system callers. */
  actor?: TokenPayload;
}

interface DepletionLine {
  ingredientId: string;
  ingredientName: string;
  zone: "BOH" | "FOH";
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
 * Resolve the location for a sale (D5): explicit arg → the caller's selected location → the menu item's
 * location, if the caller may use it → else reject.
 */
async function resolveSaleLocation(
  orgId: number,
  userId: number,
  explicit: string | undefined,
  menuItemLocation: string | null,
  actor: TokenPayload | undefined,
): Promise<string> {
  let candidate = explicit ?? (await getUserLocationContext(userId)).selectedLocationId;
  if (!candidate && menuItemLocation && (!actor || (await canAccessLocation(actor, menuItemLocation)))) candidate = menuItemLocation;
  if (!candidate) throw new SaleError("Choose a location for this sale", 400);
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, candidate), eq(storeLocation.organisationId, orgId)));
  if (!loc) throw new SaleError("Location not found in this organisation", 404);
  return candidate;
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

  /** Throws unless the ingredient is this organisation's; returns the zone its stock lives in. */
  const assertOrg = async (ingredientId: string, name: string): Promise<"BOH" | "FOH"> => {
    const [ing] = await db
      .select({ orgId: ingredient.organisationId, itemType: ingredient.itemType })
      .from(ingredient)
      .where(eq(ingredient.ingredientId, ingredientId));
    if (!ing) throw new SaleError(`Ingredient not found: ${name}`, 404);
    if (ing.orgId !== orgId) throw new SaleError(`Ingredient "${name}" is not in this organisation`, 403);
    return zoneFor(ing.itemType);
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
        const zone = await assertOrg(pl.ingredientId, pl.ingredientName);
        // raw used = (dish's prep usage) × (prep raw qty), yield-adjusted, per serving.
        const rawEntered = (dishUses * Number(pl.quantity)) / yieldFactor(pl.yieldPct) / perServing * qtySold;
        const { baseQty, baseUnit } = await resolveToBase(pl.ingredientId, rawEntered, pl.unit);
        depletions.push({ ingredientId: pl.ingredientId, ingredientName: pl.ingredientName, zone, baseQty, baseUnit });
      }
      continue;
    }

    // Legacy free-text line — cannot deplete (D1).
    if (!line.ingredientId) {
      skipped.push({ ingredientName: line.ingredientName, reason: "no linked ingredient (free-text line)" });
      continue;
    }

    const zone = await assertOrg(line.ingredientId, line.ingredientName);
    // per-serving, yield-adjusted, × qty sold. resolveToBase throws → aborts.
    const entered = Number(line.quantity) / yieldFactor(line.yieldPct) / perServing * qtySold;
    const { baseQty, baseUnit } = await resolveToBase(line.ingredientId, entered, line.unit);
    depletions.push({ ingredientId: line.ingredientId, ingredientName: line.ingredientName, zone, baseQty, baseUnit });
  }

  return { depletions, skipped };
}

/**
 * Add `delta` (negative to deduct) to the stock row of this location, ingredient and zone, locking the row; a missing
 * row is created (oversell allowed: the sale already happened). Returns the new on-hand.
 */
async function adjustSaleStock(tx: DbOrTx, locationId: string, ingredientId: string, zone: "BOH" | "FOH", delta: number): Promise<number> {
  const lock = () =>
    tx
      .select()
      .from(stockLevel)
      .where(and(eq(stockLevel.storeLocationId, locationId), eq(stockLevel.ingredientId, ingredientId), eq(stockLevel.zone, zone)))
      .for("update");
  let [row] = await lock();
  if (!row) {
    // Two sales creating the same row at once: the loser's insert is a no-op and it locks the winner's row.
    await tx.insert(stockLevel).values({ storeLocationId: locationId, ingredientId, zone, currentQty: "0", version: 0 }).onConflictDoNothing();
    [row] = await lock();
  }
  const newQty = Number(row.currentQty) + delta;
  await tx
    .update(stockLevel)
    .set({ currentQty: String(newQty), version: row.version + 1, updatedDttm: new Date() })
    .where(eq(stockLevel.stockLevelId, row.stockLevelId));
  return newQty;
}

type SaleRow = typeof sale.$inferSelect;

/**
 * A request that carries a key already recorded: the same sale again (replay), or a different one under the same
 * key (409 IDEMPOTENCY_KEY_REUSED). "Same" is the menu item and quantity, plus the time and location when the request names them.
 */
function replayOf(prior: SaleRow, input: RecordSaleInput): RecordSaleResult {
  const same =
    prior.menuItemId === input.menuItemId &&
    Number(prior.qtySold) === input.qtySold &&
    (input.soldAt === undefined || prior.soldAt.getTime() === input.soldAt.getTime()) &&
    (input.locationId === undefined || prior.storeLocationId === input.locationId);
  if (!same) throw new SaleError("This idempotency key was already used for a different sale", 409, "IDEMPOTENCY_KEY_REUSED");
  return { saleId: prior.saleId, alreadyExists: true, voided: prior.voidedAt != null, depleted: [], skipped: [], oversold: [] };
}

/** units_sold moved: bring the stored matrix along, without ever failing a sale or void that is already recorded. */
const refreshClassification = (scope: MenuScope) =>
  persistClassification(scope).catch((err) => logger.warn({ err }, "Menu classification refresh failed after a sale or void"));

/** Record a menu-item sale and refresh the stored classification of the menu. */
export async function recordSale(orgId: number, userId: number, input: RecordSaleInput): Promise<RecordSaleResult> {
  const result = await writeSale(orgId, userId, input);
  if (!result.alreadyExists) await refreshClassification(readScope(orgId, userId));
  return result;
}

/**
 * Preflight the recipe, then (in one transaction) write the sale header, bump units_sold, and deplete every
 * ingredient + log it. The stored classification is the caller's to refresh.
 */
async function writeSale(orgId: number, userId: number, input: RecordSaleInput): Promise<RecordSaleResult> {
  if (!(input.qtySold > 0)) throw new SaleError("qtySold must be greater than 0", 400);
  if (!fitsSaleQty(input.qtySold)) throw new SaleError("qtySold can have at most 3 decimal places", 400);
  const soldAt = input.soldAt ?? new Date();
  if (soldAt.getTime() > Date.now() + 60_000) throw new SaleError("soldAt cannot be in the future", 400);
  const source = input.source ?? "MANUAL";
  const key = input.idempotencyKey || null;
  if (key && key.length > 120) throw new SaleError("The idempotency key is longer than 120 characters", 400);

  // Idempotency (D13): a replayed key returns the existing sale, no re-record. The insert below is what claims the key.
  const findByKey = async (db_: DbOrTx) => {
    const [row] = await db_.select().from(sale).where(and(eq(sale.organisationId, orgId), eq(sale.idempotencyKey, key!)));
    return row;
  };
  if (key) {
    const prior = await findByKey(db);
    if (prior) return replayOf(prior, input);
  }

  // The item must be in the caller's organisation (D11a): any member who may sell can sell any item of it.
  const [mi] = await db
    .select()
    .from(menuItem)
    .where(and(eq(menuItem.menuItemId, input.menuItemId), menuReadable(readScope(orgId, userId))));
  if (!mi) throw new SaleError("Menu item not found", 404);

  // A location the request names is checked first, so another organisation's location and one the caller is not assigned to answer alike.
  if (input.actor && input.locationId) await assertLocationAccess(input.actor, input.locationId);
  const locationId = await resolveSaleLocation(orgId, userId, input.locationId, mi.storeLocationId, input.actor);
  // Checked on the RESOLVED location: it can come from the caller's selection or the menu item, not just the request.
  if (input.actor) await assertLocationAccess(input.actor, locationId);

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
        idempotencyKey: key,
        soldAt,
        createdBy: userId,
      })
      // A concurrent request with the same key committed first: nothing here is written, and this one replays it.
      .onConflictDoNothing({ target: [sale.organisationId, sale.idempotencyKey], where: sql`idempotency_key IS NOT NULL` })
      .returning();
    if (!saleRow) return replayOf((await findByKey(tx))!, input);

    await tx
      .update(menuItem)
      // shortcut: units_sold is an integer, so a fractional sale counts as its rounded quantity (the void takes the same amount back); make the column numeric when fractional sales matter to the menu mix.
      .set({ unitsSold: sql`${menuItem.unitsSold} + round(${input.qtySold}::numeric)::int`, updatedDttm: new Date() })
      .where(eq(menuItem.menuItemId, input.menuItemId));

    const depleted: RecordSaleResult["depleted"] = [];
    const oversold: string[] = [];
    for (const d of depletions) {
      const newQty = await adjustSaleStock(tx, locationId, d.ingredientId, d.zone, -d.baseQty);
      const isOversold = newQty < 0;
      if (isOversold) oversold.push(d.ingredientName);
      await tx.insert(consumptionLog).values({
        organisationId: orgId,
        storeLocationId: locationId,
        ingredientId: d.ingredientId,
        menuItemId: input.menuItemId,
        saleId: saleRow.saleId,
        zone: d.zone,
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
 * Reverse a sale (D7): restore every ingredient this sale depleted, into the zone it left, and decrement
 * units_sold. Guarded against double-void (409). Only the person who recorded the sale or an admin of its
 * organisation may void it, and only at a location they can use.
 */
export async function voidSale(scope: MenuScope & { organisationId: number }, saleId: string, actor: TokenPayload): Promise<{ saleId: string; restored: number }> {
  const [saleRow] = await db
    .select()
    .from(sale)
    .where(and(eq(sale.saleId, saleId), eq(sale.organisationId, scope.organisationId)));
  if (!saleRow) throw new SaleError("Sale not found", 404);
  if (saleRow.createdBy !== scope.userId && !scope.isOrgAdmin) {
    throw new SaleError("Only the person who recorded this sale or an organisation admin can void it", 403);
  }
  await assertLocationAccess(actor, saleRow.storeLocationId);

  const rows = await db
    .select()
    .from(consumptionLog)
    .where(eq(consumptionLog.saleId, saleId));
  // The zone the sale recorded; a row from before the zone was recorded falls back to the one the ingredient's item type lives in.
  const types = rows.length
    ? await db.select({ id: ingredient.ingredientId, itemType: ingredient.itemType }).from(ingredient).where(inArray(ingredient.ingredientId, rows.map((r) => r.ingredientId)))
    : [];
  const zoneOf = new Map(types.map((t) => [t.id, zoneFor(t.itemType)]));

  const result = await db.transaction(async (tx) => {
    // Claim the void first: a concurrent void waits here, then sees it taken.
    const [claimed] = await tx
      .update(sale)
      .set({ voidedAt: new Date(), voidedBy: scope.userId })
      .where(and(eq(sale.saleId, saleId), sql`${sale.voidedAt} IS NULL`))
      .returning({ id: sale.saleId });
    if (!claimed) throw new SaleError("Sale is already voided", 409);

    for (const r of rows) {
      // Add the depleted qty back (rows store base qty already).
      const zone = (r.zone as "BOH" | "FOH" | null) ?? zoneOf.get(r.ingredientId) ?? "BOH";
      await adjustSaleStock(tx, r.storeLocationId, r.ingredientId, zone, Number(r.quantity));
    }
    await tx
      .update(menuItem)
      .set({ unitsSold: sql`GREATEST(0, ${menuItem.unitsSold} - round(${saleRow.qtySold}::numeric)::int)`, updatedDttm: new Date() })
      .where(eq(menuItem.menuItemId, saleRow.menuItemId));
    return { saleId, restored: rows.length };
  });
  await refreshClassification(scope);
  return result;
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
          organisationId: orgId,
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
    throw new Error("Could not create the sale link for this item");
  }
}

/** Sell a FOH consumable directly: sell 3 cans → stock drops 3. */
export async function recordConsumableSale(
  orgId: number,
  userId: number,
  input: { ingredientId: string; qtySold: number; soldAt?: Date; locationId?: string; idempotencyKey?: string | null; actor?: TokenPayload },
): Promise<RecordSaleResult> {
  const menuItemId = await getOrCreateConsumableLink(orgId, userId, input.ingredientId);
  return recordSale(orgId, userId, {
    menuItemId,
    qtySold: input.qtySold,
    source: "MANUAL",
    soldAt: input.soldAt,
    locationId: input.locationId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
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

/** The items a CSV row may name: the organisation's menu, plus the caller's own system-made FOH sale links (other members' links are not dishes). */
const sellableByName = (orgId: number, userId: number) =>
  and(menuReadable(readScope(orgId, userId)), or(isNull(menuItem.linkedIngredientId), eq(menuItem.userId, userId)));

/**
 * Canonicalise a row into a stable idempotency key (D12/D13): content and the location it is sold at, not file
 * position. Without a location it is the key imports made before Wave 7, when an item was sold at one location only.
 */
function rowKey(menuItemId: string, qtySold: number, soldAt: string | undefined, occurrence: number, locationId?: string): string {
  const canonical = [menuItemId.toLowerCase(), String(qtySold), soldAt ? new Date(soldAt).toISOString() : "", occurrence, ...(locationId ? [locationId] : [])].join("|");
  return "csv:" + createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

/**
 * Phase 1 (D3): parse a sales CSV and match each row's name → menu_item_id for
 * this organisation. Deplete NOTHING. Rows are `name,qty[,soldAt]`; a header row and
 * blank rows are skipped. Unmatched/ambiguous names are reported, never dropped.
 */
export async function previewSalesCsv(orgId: number, userId: number, csvContent: string): Promise<CsvPreview> {
  const items = await db
    .select({ id: menuItem.menuItemId, name: menuItem.name })
    .from(menuItem)
    .where(sellableByName(orgId, userId));
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
    if (!(qty > 0) || !fitsSaleQty(qty)) {
      unmatched.push({ rowIndex: i, name: c0, reason: "invalid quantity" });
      return;
    }
    if (c2 && Number.isNaN(new Date(c2).getTime())) {
      unmatched.push({ rowIndex: i, name: c0, reason: "invalid date" });
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
 * Phase 2 (D12): commit matched rows. Each row is its OWN sale (per-row
 * atomic — a bad row never rolls back the others). A per-row idempotency key
 * derived from the content and the sale location makes re-importing the same file
 * at the same location a no-op, and the same line at another location its own
 * sale. A row imported before the location was part of the key is recognised at
 * the location it was recorded at. A name that matches
 * more than one item fails its row, as in the preview. The stored classification
 * is refreshed once, after the last row.
 */
export async function commitSalesCsv(orgId: number, userId: number, lines: CsvSaleLine[], actor?: TokenPayload) {
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
      const [mi, another] = await db
        .select({ id: menuItem.menuItemId, storeLocationId: menuItem.storeLocationId })
        .from(menuItem)
        .where(and(sellableByName(orgId, userId), sql`lower(${menuItem.name}) = ${line.name.toLowerCase()}`))
        .limit(2);
      if (!mi || another) {
        failed.push({ rowIndex: line.rowIndex, reason: mi ? "ambiguous name (multiple menu items)" : "no matching menu item" });
        continue;
      }
      const locationId = await resolveSaleLocation(orgId, userId, undefined, mi.storeLocationId, actor);
      const [legacy] = await db
        .select({ saleId: sale.saleId, voidedAt: sale.voidedAt })
        .from(sale)
        .where(and(eq(sale.organisationId, orgId), eq(sale.idempotencyKey, rowKey(mi.id, line.qtySold, line.soldAt, n)), eq(sale.storeLocationId, locationId)));
      if (legacy) {
        alreadyExists.push({ rowIndex: line.rowIndex, saleId: legacy.saleId, voided: legacy.voidedAt != null });
        continue;
      }
      const res = await writeSale(orgId, userId, {
        menuItemId: mi.id,
        qtySold: line.qtySold,
        source: "CSV",
        soldAt: line.soldAt ? new Date(line.soldAt) : undefined,
        locationId,
        idempotencyKey: rowKey(mi.id, line.qtySold, line.soldAt, n, locationId),
        actor,
      });
      if (res.alreadyExists) alreadyExists.push({ rowIndex: line.rowIndex, saleId: res.saleId, voided: !!res.voided });
      else succeeded.push({ rowIndex: line.rowIndex, saleId: res.saleId });
    } catch (err) {
      failed.push({ rowIndex: line.rowIndex, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  if (succeeded.length) await refreshClassification(readScope(orgId, userId));

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
      createdBy: sale.createdBy,
    })
    .from(sale)
    .innerJoin(menuItem, eq(sale.menuItemId, menuItem.menuItemId))
    .where(and(eq(sale.organisationId, orgId), eq(sale.storeLocationId, locationId)))
    .orderBy(desc(sale.soldAt))
    .limit(limit);
}
