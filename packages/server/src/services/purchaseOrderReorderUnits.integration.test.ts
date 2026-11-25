import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  ingredient, ingredientSupplier, locationIngredient, orderGuide, orderGuideItem, purchaseOrder, purchaseOrderLine, stockLevel,
  supplier, unitConversion,
} from "../db/schema.js";
import { createGuide, setGuideItems, getGuideItems } from "./orderGuideService.js";
import { handleClonePO } from "../controllers/purchaseOrderController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Reorder tops up to par. Par and stock are in the kitchen unit; the line is in the unit it is ordered in (bag, case).
 * The shortfall used to be written as it was: 62.5 kg below par of a 12.5 kg bag was reordered as 62.5 bags.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

type Item = Partial<typeof ingredient.$inferInsert> & { par?: string; stock?: string; min?: string; conversion?: [string, string] };
type Line = { item: Item; qty: string; unit: string; cost?: string };

let fx: LineLoopFx;
let supplierId = "";
let guideId = "";
let seq = 0;
const ingIds: string[] = [];

async function makeItem({ par, stock, min, conversion, ...fields }: Item) {
  const [{ id }] = await db
    .insert(ingredient)
    .values({ organisationId: fx.orgId, ingredientName: `${fx.tag}-i${++seq}`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg", ...fields })
    .returning({ id: ingredient.ingredientId });
  ingIds.push(id);
  await db.insert(locationIngredient).values({ ingredientId: id, storeLocationId: fx.locA, activeInd: true, parLevel: par ?? null });
  if (stock) await db.insert(stockLevel).values({ storeLocationId: fx.locA, ingredientId: id, currentQty: stock });
  if (min) await db.insert(ingredientSupplier).values({ ingredientId: id, supplierId, minimumOrderQty: min });
  if (conversion) await db.insert(unitConversion).values({ ingredientId: id, fromUnit: conversion[0], toBaseFactor: conversion[1] });
  return id;
}

/** A received order with these lines. */
async function orderOf(lines: Line[], createdDttm = new Date()) {
  const [{ id: poId }] = await db
    .insert(purchaseOrder)
    .values({ organisationId: fx.orgId, storeLocationId: fx.locA, supplierId, poNumber: `${fx.tag}-${++seq}`, status: "RECEIVED", createdByUserId: fx.chef, createdDttm })
    .returning({ id: purchaseOrder.poId });
  const made = [];
  for (const l of lines) {
    const ingredientId = await makeItem(l.item);
    await db.insert(purchaseOrderLine).values({ poId, ingredientId, orderedQty: l.qty, orderedUnit: l.unit, unitCost: l.cost ?? "17.5" });
    made.push(ingredientId);
  }
  return { poId, ingredientIds: made };
}

const reorder = (poId: string) => callHandler(handleClonePO, asUser(fx.chef, ["purchasing:draft"]), { params: { id: poId }, body: { storeLocationId: fx.locA } });

/** What was reordered, in the order the ingredients were ordered in (the rows come back in no set order). */
const quantities = (body: Record<string, any>, ingredientIds: string[]) =>
  ingredientIds.map((id) => {
    const l = body.lines.find((x: { ingredientId: string }) => x.ingredientId === id);
    return `${l.orderedQty} ${l.orderedUnit}`;
  });

/** Reorders an order of this one line. */
async function reorderOne(item: Item, qty: string, unit: string) {
  const { poId } = await orderOf([{ item, qty, unit }]);
  const out = await reorder(poId);
  expect(out.status).toBe(201);
  expect(out.body.lines).toHaveLength(1);
  const [line] = out.body.lines;
  return { qty: Number(line.orderedQty), unit: line.orderedUnit, cost: Number(line.unitCost), warnings: out.body.quantityWarnings };
}

const flour: Item = { baseUnit: "kg", purchaseUnit: "bag", packQty: "12.5" };

describe.skipIf(!RUN)("reorder quantities are in the line's own unit (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`rou_${Date.now().toString(36)}`);
    [{ id: supplierId }] = await db.insert(supplier).values({ organisationId: fx.orgId, supplierName: `${fx.tag}-mill` }).returning({ id: supplier.supplierId });
  });
  afterAll(async () => {
    if (guideId) {
      await db.delete(orderGuideItem).where(eq(orderGuideItem.orderGuideId, guideId));
      await db.delete(orderGuide).where(eq(orderGuide.orderGuideId, guideId));
    }
    const poIds = (await db.select({ id: purchaseOrder.poId }).from(purchaseOrder).where(eq(purchaseOrder.organisationId, fx.orgId))).map((r) => r.id);
    if (poIds.length) {
      await db.delete(purchaseOrderLine).where(inArray(purchaseOrderLine.poId, poIds));
      await db.delete(purchaseOrder).where(inArray(purchaseOrder.poId, poIds));
    }
    if (ingIds.length) {
      await db.delete(stockLevel).where(inArray(stockLevel.ingredientId, ingIds));
      await db.delete(locationIngredient).where(inArray(locationIngredient.ingredientId, ingIds));
      await db.delete(ingredientSupplier).where(inArray(ingredientSupplier.ingredientId, ingIds));
      await db.delete(unitConversion).where(inArray(unitConversion.ingredientId, ingIds));
      await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    }
    if (supplierId) await db.delete(supplier).where(eq(supplier.supplierId, supplierId));
    await removeLineLoopFx(fx);
  });

  it("62.5 kg below par of a 12.5 kg bag is 5 bags, at the bag's price", async () => {
    expect(await reorderOne({ ...flour, par: "75", stock: "12.5" }, "2", "bag")).toEqual({ qty: 5, unit: "bag", cost: 17.5, warnings: [] });
  });

  it.each<[string, Item, string, number]>([
    ["part of a bag rounds up", { ...flour, par: "13" }, "bag", 2],
    ["a case of 12 bottles", { baseUnit: "bottle", purchaseUnit: "case", packQty: "12", par: "30", stock: "4" }, "case", 3],
    ["an operator's own conversion", { baseUnit: "each", conversion: ["carton", "30"], par: "70", stock: "9" }, "carton", 3],
    ["kg of an item stocked in grams", { baseUnit: "g", par: "25000", stock: "5000" }, "kg", 20],
    ["each stays exact", { baseUnit: "each", par: "12", stock: "5" }, "each", 7],
    ["kg stays exact, even for an item sold in bags", { ...flour, par: "12", stock: "9.7" }, "kg", 2.3],
    ["the supplier's minimum, in bags", { ...flour, par: "20", stock: "15", min: "3" }, "bag", 3],
    ["the supplier's minimum of 2 bags, on a line in kg", { ...flour, par: "20", stock: "15", min: "2" }, "kg", 25],
  ])("%s", async (_name, item, unit, qty) => {
    expect(await reorderOne(item, "1", unit)).toMatchObject({ qty, unit, warnings: [] });
  });

  it("an item with no par keeps the quantity it was last ordered in", async () => {
    expect(await reorderOne(flour, "1.1", "bag")).toMatchObject({ qty: 1.1, warnings: [] });
  });

  it("an item at or above par gets no line", async () => {
    const { poId, ingredientIds } = await orderOf([
      { item: { ...flour, par: "25", stock: "25" }, qty: "4", unit: "bag" },
      { item: { ...flour, par: "25", stock: "40" }, qty: "4", unit: "bag" },
      { item: { ...flour, par: "25" }, qty: "4", unit: "bag" },
    ]);
    const out = await reorder(poId);
    expect(out.body.lines).toMatchObject([{ ingredientId: ingredientIds[2], orderedQty: "2" }]);
    expect(out.body.skippedItems).toHaveLength(2);
  });

  it("without a pack size the last quantity is kept and the answer says which item", async () => {
    const { poId, ingredientIds } = await orderOf([
      { item: { baseUnit: "kg", purchaseUnit: "bag", par: "75", ingredientName: `${fx.tag}-rye` }, qty: "3", unit: "bag" },
      { item: { ...flour, par: "25" }, qty: "9", unit: "bag" },
    ]);
    const out = await reorder(poId);
    expect(out.status).toBe(201);
    expect(quantities(out.body, ingredientIds)).toEqual(["3 bag", "2 bag"]);
    expect(out.body.quantityWarnings).toEqual([{ ingredientId: ingredientIds[0], ingredientName: `${fx.tag}-rye`, code: "UNIT_NOT_CONVERTIBLE" }]);
    // The fields older clients read are all still there.
    expect(out.body).toMatchObject({ status: "DRAFT", supplierId, skippedItems: [] });
    expect(out.body.poNumber).toBeTruthy();
  });

  it("an old order uses the packaging of today, and keeps a unit the item no longer has", async () => {
    const { poId, ingredientIds } = await orderOf(
      [
        { item: { ...flour, packQty: "25", par: "75" }, qty: "62.5", unit: "bag" },
        { item: { ...flour, par: "75" }, qty: "2", unit: "sack" },
      ],
      new Date("2024-01-05T00:00:00Z"),
    );
    const out = await reorder(poId);
    expect(quantities(out.body, ingredientIds)).toEqual(["3 bag", "2 sack"]);
    expect(out.body.quantityWarnings).toHaveLength(1);
  });

  it.each([
    ["nothing to reorder", async () => (await orderOf([{ item: { ...flour, par: "25", stock: "25" }, qty: "4", unit: "bag" }])).poId, "VALIDATION", /at or above par/],
    ["an order that is not there", async () => "00000000-0000-4000-8000-000000000000", "NOT_FOUND", /not found/],
    ["an id that is not one", async () => "nope", "VALIDATION", /UUID/],
  ])("answers 400 with a code for %s", async (_name, poId, code, text) => {
    const out = await reorder(await poId());
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ code, error: expect.stringMatching(text) });
  });

  it("answers 400 with a code, not 500, when the supplier is no longer active", async () => {
    const { poId } = await orderOf([{ item: { ...flour, par: "25" }, qty: "4", unit: "bag" }]);
    await db.update(supplier).set({ activeInd: false }).where(eq(supplier.supplierId, supplierId));
    try {
      const out = await reorder(poId);
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ code: "VALIDATION", error: expect.stringMatching(/no longer active/) });
    } finally {
      await db.update(supplier).set({ activeInd: true }).where(eq(supplier.supplierId, supplierId));
    }
  });

  it("an order guide offers an item with no pack size in its kitchen unit, where the shortfall is right", async () => {
    const noPack = await makeItem({ baseUnit: "kg", purchaseUnit: "bag", par: "25" });
    const bagged = await makeItem({ ...flour, par: "25" });
    guideId = (await createGuide(fx.orgId, fx.chef, { supplierId, storeLocationId: fx.locA, name: "Weekly" })).orderGuideId;
    await setGuideItems(guideId, fx.orgId, [{ ingredientId: noPack, sortOrder: 0 }, { ingredientId: bagged, sortOrder: 1 }]);

    // Both forms order suggestedPackages ?? suggestedOrderQty, in purchaseUnit || baseUnit.
    expect(await getGuideItems(guideId, fx.orgId, fx.locA)).toMatchObject([
      { purchaseUnit: null, suggestedPackages: null, suggestedOrderQty: 25, baseUnit: "kg" },
      { purchaseUnit: "bag", suggestedPackages: 2 },
    ]);
  });
});
