import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  storeLocation,
  ingredient,
  locationIngredient,
  stockLevel,
  fohSale,
  consumptionLog,
} from "../db/schema.js";
import {
  moveToFoh,
  recountFoh,
  suggestFohRestock,
  getFohStock,
  FohError,
} from "./fohStockService.js";
import { recordFohSales, getFohSalesReport, listFohSales } from "./fohSalesService.js";
import { logConsumption } from "./consumptionLogService.js";

/**
 * Real-database integration suite for the Front-of-House stock loop. Seeds one
 * org + location + a FOH consumable (with a BOH stock row) into a live Postgres
 * and drives the actual service SQL — the raw zone joins, FOR UPDATE deduction,
 * and COGS rollup the mocked unit tests cannot exercise.
 *
 * Gated on FOH_IT=1 so the DB-less CI job skips it. Self-cleaning: afterAll
 * deletes exactly the rows it seeded.
 *
 *   FOH_IT=1 npx vitest run src/services/fohStock.integration.test.ts
 */
const RUN = process.env.FOH_IT === "1";

describe.skipIf(!RUN)("FOH stock + sales — real DB", () => {
  const tag = `fohit_${Date.now()}`;
  let userId: number;
  let orgId: number;
  let locId: string;
  let fohId: string; // FOH consumable
  let kitchenId: string; // non-FOH item (rejection case)

  beforeAll(async () => {
    [{ userId }] = await db
      .insert(user)
      .values({ userName: "FOH IT", userEmail: `${tag}@it.test` })
      .returning({ userId: user.userId });

    [{ id: orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-org`, joinKey: `${tag}-key`, createdBy: userId })
      .returning({ id: organisation.organisationId });

    [{ id: locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: orgId,
        locationName: `${tag}-loc`,
        classification: "branch",
        storeKey: `${tag}-sk`.slice(0, 25),
        createdBy: userId,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: fohId }] = await db
      .insert(ingredient)
      .values({
        organisationId: orgId,
        ingredientName: `${tag}-cola`,
        ingredientCategory: "beverages",
        itemType: "FOH_CONSUMABLE",
        baseUnit: "each",
      })
      .returning({ id: ingredient.ingredientId });

    [{ id: kitchenId }] = await db
      .insert(ingredient)
      .values({
        organisationId: orgId,
        ingredientName: `${tag}-flour`,
        ingredientCategory: "dry_goods",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "kg",
      })
      .returning({ id: ingredient.ingredientId });

    // FOH par = 20, WAC = 2.50 (drives restock suggestion + COGS).
    await db.insert(locationIngredient).values({
      ingredientId: fohId,
      storeLocationId: locId,
      fohParLevel: "20",
      weightedAverageCost: "2.5000",
      activeInd: true,
    });

    // Seed BOH stock = 24 (the "existing Stock column" number).
    await db.insert(stockLevel).values({
      storeLocationId: locId,
      ingredientId: fohId,
      zone: "BOH",
      currentQty: "24",
    });
  });

  afterAll(async () => {
    await db.delete(fohSale).where(eq(fohSale.organisationId, orgId));
    await db.delete(consumptionLog).where(eq(consumptionLog.organisationId, orgId));
    await db.delete(stockLevel).where(eq(stockLevel.storeLocationId, locId));
    await db.delete(locationIngredient).where(eq(locationIngredient.storeLocationId, locId));
    await db.delete(ingredient).where(inArray(ingredient.ingredientId, [fohId, kitchenId]));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locId));
    await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    await db.delete(user).where(eq(user.userId, userId));
  });

  async function zoneQty(zone: "BOH" | "FOH"): Promise<number> {
    const [row] = await db
      .select({ q: stockLevel.currentQty })
      .from(stockLevel)
      .where(
        and(
          eq(stockLevel.storeLocationId, locId),
          eq(stockLevel.ingredientId, fohId),
          eq(stockLevel.zone, zone),
        ),
      );
    return row ? Number(row.q) : 0;
  }

  it("moveToFoh conserves BOH+FOH within the location", async () => {
    const res = await moveToFoh(orgId, locId, fohId, 10);
    expect(res.bohQty).toBe(14);
    expect(res.fohQty).toBe(10);
    expect(await zoneQty("BOH")).toBe(14);
    expect(await zoneQty("FOH")).toBe(10);
  });

  it("moveToFoh rejects moving more than BOH holds", async () => {
    await expect(moveToFoh(orgId, locId, fohId, 999)).rejects.toBeInstanceOf(FohError);
    // BOH untouched by the failed move
    expect(await zoneQty("BOH")).toBe(14);
  });

  it("moveToFoh rejects a non-FOH item", async () => {
    await expect(moveToFoh(orgId, locId, kitchenId, 1)).rejects.toBeInstanceOf(FohError);
  });

  it("recordFohSales deducts FOH and does not flag a within-stock sale", async () => {
    const res = await recordFohSales(orgId, locId, [{ ingredientId: fohId, quantity: 3, unitPrice: 4 }], "MANUAL", userId);
    expect(res.recorded).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
    expect(res.oversoldCount).toBe(0);
    expect(res.recorded[0].oversold).toBe(false);
    expect(await zoneQty("FOH")).toBe(7); // 10 - 3
  });

  it("recordFohSales allows and flags an oversell (sale still recorded)", async () => {
    const res = await recordFohSales(orgId, locId, [{ ingredientId: fohId, quantity: 100, unitPrice: 4 }], "MANUAL", userId);
    expect(res.oversoldCount).toBe(1);
    expect(res.recorded[0].oversold).toBe(true);
    expect(await zoneQty("FOH")).toBe(-93); // 7 - 100
  });

  it("recordFohSales rejects invalid lines but still posts valid ones", async () => {
    const res = await recordFohSales(
      orgId,
      locId,
      [
        { ingredientId: kitchenId, quantity: 1 }, // not a FOH consumable
        { ingredientId: fohId, quantity: 0 }, // bad qty
        { ingredientId: fohId, quantity: 2, unitPrice: 4 }, // valid
      ],
      "CSV",
      userId,
    );
    expect(res.recorded).toHaveLength(1);
    expect(res.rejected).toHaveLength(2);
  });

  it("recountFoh resets FOH to the counted value and reports variance", async () => {
    const res = await recountFoh(orgId, locId, fohId, 5, userId);
    expect(res.countedQty).toBe(5);
    expect(await zoneQty("FOH")).toBe(5);
    expect(res.varianceQty).toBe(5 - res.previousQty);
  });

  it("suggestFohRestock suggests up to par, capped by available BOH", async () => {
    // FOH now 5, par 20 -> shortfall 15; BOH is 14 -> capped to 14.
    const suggestions = await suggestFohRestock(locId);
    const s = suggestions.find((x) => x.ingredientId === fohId);
    expect(s).toBeDefined();
    expect(s!.suggestedQty).toBe(14);
  });

  it("logConsumption with zone FOH deducts the FOH shelf", async () => {
    const before = await zoneQty("FOH");
    await logConsumption(orgId, locId, userId, { ingredientId: fohId, quantity: 1, unit: "each", reason: "waste", zone: "FOH" });
    expect(await zoneQty("FOH")).toBe(before - 1);
    expect(await zoneQty("BOH")).toBe(14); // BOH untouched
  });

  it("getFohStock returns BOH + FOH with a low-FOH flag", async () => {
    const rows = await getFohStock(locId);
    const row = rows.find((r) => r.ingredientId === fohId);
    expect(row).toBeDefined();
    expect(row!.bohQty).toBe(14);
    expect(row!.fohParLevel).toBe(20);
    expect(row!.lowFoh).toBe(true); // FOH (4) < par (20)
  });

  it("getFohSalesReport computes revenue, COGS (via WAC) and margin", async () => {
    const report = await getFohSalesReport(orgId, { storeLocationId: locId });
    const item = report.items.find((i) => i.ingredientId === fohId);
    expect(item).toBeDefined();
    // Priced sales: 3 + 2 + 100 = 105 units @ $4 = $420 revenue.
    expect(item!.revenue).toBeCloseTo(420, 2);
    // COGS = 105 * WAC(2.50) = 262.50.
    expect(item!.cogs).toBeCloseTo(262.5, 2);
    expect(item!.margin).toBeCloseTo(157.5, 2);
    // Two lines sold while FOH was already negative: the 100-unit sale and the
    // later 2-unit sale (FOH was -93 by then).
    expect(item!.oversoldLines).toBe(2);
  });

  it("listFohSales returns the recorded sales newest-first", async () => {
    const sales = await listFohSales(locId, orgId, { limit: 10 });
    expect(sales.length).toBeGreaterThanOrEqual(3);
    expect(sales.every((s) => s.ingredientId === fohId)).toBe(true);
  });
});
