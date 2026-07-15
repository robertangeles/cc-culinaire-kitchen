import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  storeLocation,
  ingredient,
  locationIngredient,
  unitConversion,
  stockLevel,
  consumptionLog,
  menuItem,
  menuItemIngredient,
  sale,
  purchaseOrder,
  purchaseOrderLine,
  fifoBatch,
  supplier,
} from "../db/schema.js";
import { resolveToBase, getValidUnits, invalidateConversionCache } from "./unitConversionService.js";
import { logConsumption } from "./consumptionLogService.js";
import { changeKitchenUnit } from "./ingredientService.js";
import { receiveLine } from "./purchaseOrderService.js";
import {
  recordSale,
  voidSale,
  recordConsumableSale,
  listSellableConsumables,
  previewSalesCsv,
  commitSalesCsv,
  SaleError,
} from "./saleService.js";
import { IncompatibleUnitsError } from "@culinaire/shared";

/**
 * Real-DB end-to-end suite for the KITCHEN-UNIT model + recipe-based selling.
 *
 * The model under test (physical reality, not database fields):
 *  - every item has ONE kitchen unit it is counted/stocked in
 *    (wine: bottle, flour: g, oil: ml, cans/napkins: each);
 *  - purchase packaging (case, bag) exists ONLY at ordering/receiving and
 *    converts to kitchen units at the receiving boundary;
 *  - recipes may use measured units (150 ml) against a counted item via the
 *    content equivalence (1 bottle = 750 ml) → fractional depletion (0.2 bottle);
 *  - selling a menu item explodes the recipe; FOH consumables sell directly.
 *
 * Gated on UOM_IT=1. Self-cleaning.
 *   DATABASE_URL=... UOM_IT=1 npx vitest run src/services/uomAndSelling.integration.test.ts
 */
const RUN = process.env.UOM_IT === "1";

export const fx = {
  tag: `uomit_${Date.now()}`,
  userId: 0,
  orgId: 0,
  locId: "",
  wineId: "", // kitchen unit bottle, contains 750 ml, case of 12
  flourId: "", // kitchen unit g, bag of 25000
  cokeId: "", // FOH consumable, kitchen unit each, case of 24
  oilId: "", // measured kitchen unit stays ml
  quirkId: "", // g with a deliberately-wrong kg row (D9)
  flipId: "", // starts as ml, flipped to bottle by changeKitchenUnit
  supplierId: "",
  glassId: "",
  bottleItemId: "",
  dishId: "",
};

describe.skipIf(!RUN)("kitchen-unit model + recipe selling — real DB", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "UOM IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });
    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-key`, createdBy: fx.userId })
      .returning({ id: organisation.organisationId });
    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-sk`.slice(0, 25),
        createdBy: fx.userId,
      })
      .returning({ id: storeLocation.storeLocationId });

    const mkIng = async (v: {
      name: string; base: string; itemType?: string; contentQty?: string; contentUnit?: string;
      purchaseUnit?: string; packQty?: string; stock?: string; wac?: string;
    }) => {
      const [row] = await db
        .insert(ingredient)
        .values({
          organisationId: fx.orgId,
          ingredientName: v.name,
          ingredientCategory: "other",
          itemType: v.itemType ?? "KITCHEN_INGREDIENT",
          baseUnit: v.base,
          contentQty: v.contentQty ?? null,
          contentUnit: v.contentUnit ?? null,
          purchaseUnit: v.purchaseUnit ?? null,
          packQty: v.packQty ?? null,
          preferredUnitCost: v.wac ?? null,
        })
        .returning({ id: ingredient.ingredientId });
      await db.insert(locationIngredient).values({
        ingredientId: row.id,
        storeLocationId: fx.locId,
        weightedAverageCost: v.wac ?? null,
        activeInd: true,
      });
      if (v.stock !== undefined) {
        await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: row.id, currentQty: v.stock });
      }
      return row.id;
    };

    // Wine: counted in bottles; 1 bottle = 750 ml; bought as a case of 12; 8 on hand @ $15/bottle.
    fx.wineId = await mkIng({ name: `${fx.tag}-wine`, base: "bottle", contentQty: "750", contentUnit: "ml", purchaseUnit: "case", packQty: "12", stock: "8", wac: "15.0000" });
    // Flour: counted in grams; bought as a 25 kg bag; 12.5 kg on hand.
    fx.flourId = await mkIng({ name: `${fx.tag}-flour`, base: "g", purchaseUnit: "bag", packQty: "25000", stock: "12500", wac: "0.0020" });
    // Coke: FOH consumable, each; case of 24; 10 on hand.
    fx.cokeId = await mkIng({ name: `${fx.tag}-coke`, base: "each", itemType: "FOH_CONSUMABLE", purchaseUnit: "case", packQty: "24", stock: "10", wac: "1.2000" });
    // Oil: a measured kitchen unit (ml) — like flour, mL IS what you count.
    fx.oilId = await mkIng({ name: `${fx.tag}-oil`, base: "ml", stock: "5000", wac: "0.0100" });
    // Quirk: explicit conversion row (kg → 500) must beat family math (D9).
    fx.quirkId = await mkIng({ name: `${fx.tag}-quirk`, base: "g", stock: "1000" });
    await db.insert(unitConversion).values({ ingredientId: fx.quirkId, fromUnit: "kg", toBaseFactor: "500" });
    invalidateConversionCache(fx.quirkId);
    // Flip candidate: created wrong (ml) like the real wines were.
    fx.flipId = await mkIng({ name: `${fx.tag}-flip`, base: "ml", stock: "6000", wac: "0.0200" });

    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-supplier` })
      .returning({ id: supplier.supplierId });
  });

  afterAll(async () => {
    const ingIds = [fx.wineId, fx.flourId, fx.cokeId, fx.oilId, fx.quirkId, fx.flipId];
    await db.delete(consumptionLog).where(eq(consumptionLog.organisationId, fx.orgId));
    await db.delete(sale).where(eq(sale.organisationId, fx.orgId));
    await db.delete(menuItem).where(eq(menuItem.userId, fx.userId)); // cascades recipe lines
    await db.delete(fifoBatch).where(eq(fifoBatch.storeLocationId, fx.locId));
    await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.ingredientId, ingIds));
    await db.delete(purchaseOrder).where(eq(purchaseOrder.organisationId, fx.orgId));
    await db.delete(supplier).where(eq(supplier.organisationId, fx.orgId));
    await db.delete(stockLevel).where(eq(stockLevel.storeLocationId, fx.locId));
    await db.delete(unitConversion).where(inArray(unitConversion.ingredientId, ingIds));
    await db.delete(locationIngredient).where(eq(locationIngredient.storeLocationId, fx.locId));
    await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    await db.delete(user).where(eq(user.userId, fx.userId));
  });

  async function stockQtyOf(ingredientId: string): Promise<number> {
    const [row] = await db
      .select({ q: stockLevel.currentQty })
      .from(stockLevel)
      .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, ingredientId)));
    return row ? Number(row.q) : 0;
  }

  // ── Resolver: every stage converts to the kitchen unit ───────────────────
  describe("resolver — packaging, content equivalence, families", () => {
    it("kitchen unit passes through (5 bottles = 5)", async () => {
      expect(await resolveToBase(fx.wineId, 5, "bottle")).toEqual({ baseQty: 5, baseUnit: "bottle" });
    });

    it("purchase packaging converts at the boundary (2 cases = 24 bottles)", async () => {
      expect(await resolveToBase(fx.wineId, 2, "case")).toEqual({ baseQty: 24, baseUnit: "bottle" });
    });

    it("a 25 kg bag of flour = 25000 g", async () => {
      expect(await resolveToBase(fx.flourId, 1, "bag")).toEqual({ baseQty: 25000, baseUnit: "g" });
    });

    it("content equivalence: 150 ml of wine = 0.2 bottle", async () => {
      expect((await resolveToBase(fx.wineId, 150, "ml")).baseQty).toBeCloseTo(0.2, 10);
    });

    it("content equivalence across volume units: 1.5 L = 2 bottles", async () => {
      expect((await resolveToBase(fx.wineId, 1.5, "l")).baseQty).toBeCloseTo(2, 10);
    });

    it("same-family standard conversion: 2 kg flour = 2000 g", async () => {
      expect(await resolveToBase(fx.flourId, 2, "kg")).toEqual({ baseQty: 2000, baseUnit: "g" });
    });

    it("D9: an explicit conversion row beats family math (kg→500, not 1000)", async () => {
      expect((await resolveToBase(fx.quirkId, 1, "kg")).baseQty).toBe(500);
    });

    it("no path → IncompatibleUnitsError (kg of wine)", async () => {
      await expect(resolveToBase(fx.wineId, 1, "kg")).rejects.toBeInstanceOf(IncompatibleUnitsError);
    });

    it("getValidUnits(wine) offers bottle, case, and ml", async () => {
      const units = await getValidUnits(fx.wineId);
      expect(units).toEqual(expect.arrayContaining(["bottle", "case", "ml"]));
    });

    it("a measured kitchen unit stays itself (oil: ml)", async () => {
      expect(await resolveToBase(fx.oilId, 250, "ml")).toEqual({ baseQty: 250, baseUnit: "ml" });
    });
  });

  // ── changeKitchenUnit: the migration path the real wines took ────────────
  describe("changeKitchenUnit (unit flip with stock conversion)", () => {
    it("flips ml → bottle: stock ÷750, WAC ×750", async () => {
      await db.update(ingredient)
        .set({ contentQty: "750", contentUnit: "ml" })
        .where(eq(ingredient.ingredientId, fx.flipId));
      await changeKitchenUnit(fx.flipId, fx.orgId, "bottle", 750);
      expect(await stockQtyOf(fx.flipId)).toBeCloseTo(8, 6); // 6000 ml → 8 bottles
      const [li] = await db
        .select({ wac: locationIngredient.weightedAverageCost })
        .from(locationIngredient)
        .where(and(eq(locationIngredient.ingredientId, fx.flipId), eq(locationIngredient.storeLocationId, fx.locId)));
      expect(Number(li.wac)).toBeCloseTo(15, 4); // $0.02/ml → $15/bottle
      // And the resolver now understands measured entries against it.
      expect((await resolveToBase(fx.flipId, 375, "ml")).baseQty).toBeCloseTo(0.5, 10);
    });
  });

  // ── Stock flows: packaging only at boundaries; stock in kitchen units ────
  describe("stock flows", () => {
    it("consumption logged in the kitchen unit (0.5 bottle waste) + base_qty written", async () => {
      const entry = await logConsumption(fx.orgId, fx.locId, fx.userId, {
        ingredientId: fx.wineId,
        quantity: 0.5,
        unit: "bottle",
        reason: "waste",
      });
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(7.5, 6); // 8 − 0.5
      expect(Number((entry as { baseQty: string | null }).baseQty)).toBeCloseTo(0.5, 6);
    });

    it("consumption logged in ml deducts fractional bottles (300 ml = 0.4)", async () => {
      await logConsumption(fx.orgId, fx.locId, fx.userId, {
        ingredientId: fx.wineId,
        quantity: 300,
        unit: "ml",
        reason: "waste",
      });
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(7.1, 6); // 7.5 − 0.4
    });

    it("legacy PO receiving converts cases → bottles AND cost → per-bottle (the pre-existing bug, fixed)", async () => {
      const [po] = await db
        .insert(purchaseOrder)
        .values({
          organisationId: fx.orgId,
          storeLocationId: fx.locId,
          supplierId: fx.supplierId,
          poNumber: `${fx.tag}-PO1`,
          status: "SUBMITTED",
          createdByUserId: fx.userId,
        })
        .returning();
      const [line] = await db
        .insert(purchaseOrderLine)
        .values({
          poId: po.poId,
          ingredientId: fx.wineId,
          ingredientName: `${fx.tag}-wine`,
          orderedQty: "2",
          orderedUnit: "case",
          unitCost: "60", // $60 per case of 12
          lineStatus: "PENDING",
        })
        .returning();

      const before = await stockQtyOf(fx.wineId);
      await receiveLine(po.poId, line.lineId, "2", "case", "60", fx.userId, fx.orgId);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before + 24, 6); // 2 cases = 24 bottles

      const [batch] = await db
        .select()
        .from(fifoBatch)
        .where(eq(fifoBatch.sourcePoLineId, line.lineId));
      expect(Number(batch.originalQuantity)).toBeCloseTo(24, 6);
      expect(Number(batch.unitCost)).toBeCloseTo(5, 4); // $60/case ÷ 12 = $5/bottle
    });
  });

  // ── Recipe-based selling: mL recipes deplete fractional bottles ──────────
  describe("recipe-based selling", () => {
    const mkMenuItem = async (name: string, price: string): Promise<string> => {
      const [row] = await db
        .insert(menuItem)
        .values({ userId: fx.userId, storeLocationId: fx.locId, name, category: "drinks", sellingPrice: price, servings: 1 })
        .returning({ id: menuItem.menuItemId });
      return row.id;
    };
    const addLine = (menuItemId: string, ingredientId: string | null, name: string, quantity: string, unit: string) =>
      db.insert(menuItemIngredient).values({
        menuItemId, ingredientId, ingredientName: name, quantity, unit, unitCost: "15", yieldPct: "100",
      });

    beforeAll(async () => {
      // Reset wine to a clean 8 bottles for deterministic math.
      await db.update(stockLevel).set({ currentQty: "8" })
        .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.wineId)));

      fx.glassId = await mkMenuItem(`${fx.tag}-glass`, "12.00");
      await addLine(fx.glassId, fx.wineId, "wine", "150", "ml"); // measured line on a counted item
      fx.bottleItemId = await mkMenuItem(`${fx.tag}-bottleitem`, "55.00");
      await addLine(fx.bottleItemId, fx.wineId, "wine", "1", "bottle"); // kitchen-unit line
      fx.dishId = await mkMenuItem(`${fx.tag}-dish`, "34.00");
      await addLine(fx.dishId, fx.wineId, "wine", "100", "ml");
      await addLine(fx.dishId, null, "garnish (free text)", "1", "each");
    });

    it("selling a Glass (150 ml recipe) deducts 0.2 BOTTLES", async () => {
      const res = await recordSale(fx.orgId, fx.userId, { menuItemId: fx.glassId, qtySold: 1 });
      expect(res.depleted[0].baseQty).toBeCloseTo(0.2, 10);
      expect(res.depleted[0].baseUnit).toBe("bottle");
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(7.8, 6);
    });

    it("5 glasses = exactly one bottle", async () => {
      await recordSale(fx.orgId, fx.userId, { menuItemId: fx.glassId, qtySold: 5 });
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(6.8, 6); // 7.8 − 1.0
    });

    it("selling the Bottle item deducts exactly 1 bottle", async () => {
      await recordSale(fx.orgId, fx.userId, { menuItemId: fx.bottleItemId, qtySold: 1 });
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(5.8, 6);
    });

    it("a dish depletes its linked line and skips the free-text line", async () => {
      const res = await recordSale(fx.orgId, fx.userId, { menuItemId: fx.dishId, qtySold: 1 });
      expect(res.depleted).toHaveLength(1);
      expect(res.depleted[0].baseQty).toBeCloseTo(100 / 750, 10);
      expect(res.skipped).toHaveLength(1);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(5.8 - 100 / 750, 6);
    });

    it("units_sold accumulates; sale rows are tagged for yield variance", async () => {
      const [mi] = await db.select({ u: menuItem.unitsSold }).from(menuItem).where(eq(menuItem.menuItemId, fx.glassId));
      expect(mi.u).toBe(6); // 1 + 5
      const rows = await db.select().from(consumptionLog)
        .where(and(eq(consumptionLog.menuItemId, fx.glassId), eq(consumptionLog.reason, "sale")));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.saleId != null && r.baseQty != null)).toBe(true);
    });

    it("voidSale restores fractional-bottle depletion exactly (+ double-void 409)", async () => {
      const before = await stockQtyOf(fx.wineId);
      const res = await recordSale(fx.orgId, fx.userId, { menuItemId: fx.glassId, qtySold: 2 });
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before - 0.4, 6);
      await voidSale(fx.orgId, fx.userId, res.saleId);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before, 6);
      await expect(voidSale(fx.orgId, fx.userId, res.saleId)).rejects.toBeInstanceOf(SaleError);
    });

    it("idempotency: a replayed key deducts once", async () => {
      const before = await stockQtyOf(fx.wineId);
      const key = `${fx.tag}-idem`;
      const first = await recordSale(fx.orgId, fx.userId, { menuItemId: fx.glassId, qtySold: 1, idempotencyKey: key });
      const replay = await recordSale(fx.orgId, fx.userId, { menuItemId: fx.glassId, qtySold: 1, idempotencyKey: key });
      expect(replay.saleId).toBe(first.saleId);
      expect(replay.alreadyExists).toBe(true);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before - 0.2, 6);
    });

    it("D11: a caller who doesn't own the menu item is rejected", async () => {
      await expect(recordSale(fx.orgId, 999999, { menuItemId: fx.glassId, qtySold: 1 })).rejects.toBeInstanceOf(SaleError);
    });
  });

  // ── FOH direct sale: consumables skip recipe math ─────────────────────────
  describe("FOH direct sale (auto 1:1 link)", () => {
    it("lists only FOH consumables as sellable", async () => {
      const sellable = await listSellableConsumables(fx.orgId);
      const ids = sellable.map((s) => s.ingredientId);
      expect(ids).toContain(fx.cokeId);
      expect(ids).not.toContain(fx.flourId); // kitchen ingredient
    });

    it("selling 3 cans drops stock by 3 — no hand-built menu item", async () => {
      const res = await recordConsumableSale(fx.orgId, fx.userId, { ingredientId: fx.cokeId, qtySold: 3 });
      expect(res.depleted[0].baseQty).toBe(3);
      expect(await stockQtyOf(fx.cokeId)).toBe(7); // 10 − 3
    });

    it("a second sale reuses the hidden link (no duplicate menu items)", async () => {
      await recordConsumableSale(fx.orgId, fx.userId, { ingredientId: fx.cokeId, qtySold: 2 });
      expect(await stockQtyOf(fx.cokeId)).toBe(5);
      const links = await db
        .select()
        .from(menuItem)
        .where(and(eq(menuItem.userId, fx.userId), eq(menuItem.linkedIngredientId, fx.cokeId)));
      expect(links).toHaveLength(1);
    });

    it("oversell is allowed + flagged (the sale happened)", async () => {
      const res = await recordConsumableSale(fx.orgId, fx.userId, { ingredientId: fx.cokeId, qtySold: 50 });
      expect(res.oversold.length).toBeGreaterThan(0);
      expect(await stockQtyOf(fx.cokeId)).toBe(-45);
    });

    it("an operational supply / kitchen ingredient cannot be sold directly", async () => {
      await expect(
        recordConsumableSale(fx.orgId, fx.userId, { ingredientId: fx.flourId, qtySold: 1 }),
      ).rejects.toBeInstanceOf(SaleError);
    });
  });

  // ── CSV import: two-phase, per-row atomic, content-keyed idempotency ─────
  describe("CSV sales import", () => {
    beforeAll(async () => {
      await db.update(stockLevel).set({ currentQty: "10" })
        .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.wineId)));
    });

    it("preview matches names, reports unmatched, depletes nothing", async () => {
      const before = await stockQtyOf(fx.wineId);
      const preview = await previewSalesCsv(fx.userId, `item,qty\n${fx.tag}-glass,2\nNo Such Item,3`);
      expect(preview.matched).toHaveLength(1);
      expect(preview.unmatched).toHaveLength(1);
      expect(await stockQtyOf(fx.wineId)).toBe(before);
    });

    it("commit depletes matched rows (2 glasses = 0.4 bottles)", async () => {
      const before = await stockQtyOf(fx.wineId);
      const res = await commitSalesCsv(fx.orgId, fx.userId, [{ rowIndex: 1, name: `${fx.tag}-glass`, qtySold: 2 }]);
      expect(res.succeeded).toHaveLength(1);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before - 0.4, 6);
    });

    it("re-importing the identical file depletes nothing (alreadyExists)", async () => {
      const before = await stockQtyOf(fx.wineId);
      const res = await commitSalesCsv(fx.orgId, fx.userId, [{ rowIndex: 1, name: `${fx.tag}-glass`, qtySold: 2 }]);
      expect(res.alreadyExists).toHaveLength(1);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before, 6);
    });

    it("partial re-import: only the edited row depletes", async () => {
      const before = await stockQtyOf(fx.wineId);
      const res = await commitSalesCsv(fx.orgId, fx.userId, [
        { rowIndex: 1, name: `${fx.tag}-glass`, qtySold: 2 }, // unchanged → deduped
        { rowIndex: 2, name: `${fx.tag}-glass`, qtySold: 3 }, // new → deducts 0.6
      ]);
      expect(res.alreadyExists.map((r) => r.rowIndex)).toContain(1);
      expect(res.succeeded.map((r) => r.rowIndex)).toContain(2);
      expect(await stockQtyOf(fx.wineId)).toBeCloseTo(before - 0.6, 6);
    });
  });
});
