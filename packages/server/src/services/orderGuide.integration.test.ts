import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  storeLocation,
  supplier,
  ingredient,
  ingredientSupplier,
  locationIngredient,
  stockLevel,
  orderGuide,
  orderGuideItem,
} from "../db/schema.js";
import {
  createGuide,
  setGuideItems,
  getGuideItems,
  listGuides,
} from "./orderGuideService.js";
import { listLocationIngredients } from "./ingredientService.js";

/**
 * Order guides end-to-end against the real DB. Proves T2 + the folded decisions:
 *  - getGuideItems computes suggestedOrderQty = par - on-hand via poMath (T2)
 *  - the supplier's minimum_order_qty is surfaced (T7)
 *  - cost resolves from ingredient.preferred_unit_cost (T10)
 *  - a soft-deleted ingredient drops out of the guide render (T11)
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `og_${Date.now().toString(36)}`,
  userId: 0,
  orgId: 0,
  locId: "",
  supplierId: "",
  wineId: "", // below par, priced, has supplier min
  flourId: "", // will be soft-deleted mid-test
  guideId: "",
};

describe.skipIf(!RUN)("order guides end-to-end (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "OG IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userId })
      .returning({ id: organisation.organisationId });

    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-s`.slice(0, 25),
        createdBy: fx.userId,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: fx.supplierId }] = await db
      .insert(supplier)
      .values({ organisationId: fx.orgId, supplierName: `${fx.tag}-sup` })
      .returning({ id: supplier.supplierId });

    [{ id: fx.wineId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId,
        ingredientName: `${fx.tag}-shiraz`,
        ingredientCategory: "spirits",
        itemType: "FOH_CONSUMABLE",
        baseUnit: "bottle",
        parLevel: "8", // org default par
        purchaseUnit: "case",
        packQty: "12",
        preferredUnitCost: "15", // T10: this wins over location/org unit_cost
      })
      .returning({ id: ingredient.ingredientId });

    [{ id: fx.flourId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId,
        ingredientName: `${fx.tag}-flour`,
        ingredientCategory: "dry",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "g",
        parLevel: "25000",
      })
      .returning({ id: ingredient.ingredientId });

    // Supplier link for the wine: minimum order 2, cost 15/bottle.
    await db.insert(ingredientSupplier).values({
      ingredientId: fx.wineId,
      supplierId: fx.supplierId,
      minimumOrderQty: "2",
      costPerUnit: "15",
      preferredInd: true,
    });

    // On-hand 3 bottles vs par 8 → below par, suggested order 5.
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.wineId, currentQty: "3" });
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.flourId, currentQty: "0" });
  });

  afterAll(async () => {
    if (fx.guideId) {
      await db.delete(orderGuideItem).where(eq(orderGuideItem.orderGuideId, fx.guideId));
      await db.delete(orderGuide).where(eq(orderGuide.orderGuideId, fx.guideId));
    }
    if (fx.locId) {
      await db.delete(stockLevel).where(eq(stockLevel.storeLocationId, fx.locId));
      await db.delete(locationIngredient).where(eq(locationIngredient.storeLocationId, fx.locId));
    }
    const ingIds = [fx.wineId, fx.flourId].filter(Boolean);
    if (ingIds.length) {
      await db.delete(ingredientSupplier).where(inArray(ingredientSupplier.ingredientId, ingIds));
      await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    }
    if (fx.supplierId) await db.delete(supplier).where(eq(supplier.supplierId, fx.supplierId));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    if (fx.userId) await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("creates a guide, sets items, and prices them to par", async () => {
    const guide = await createGuide(fx.orgId, fx.userId, {
      supplierId: fx.supplierId,
      storeLocationId: fx.locId,
      name: "Weekly Wine",
    });
    fx.guideId = guide.orderGuideId;

    await setGuideItems(fx.guideId, fx.orgId, [
      { ingredientId: fx.wineId, sortOrder: 0 },
      { ingredientId: fx.flourId, sortOrder: 1 },
    ]);

    const guides = await listGuides(fx.orgId, fx.locId);
    const mine = guides.find((g) => g.orderGuideId === fx.guideId);
    expect(mine).toBeTruthy();
    expect(mine!.itemCount).toBe(2);
    expect(mine!.supplierName).toBe(`${fx.tag}-sup`);

    const items = await getGuideItems(fx.guideId, fx.orgId, fx.locId);
    const wine = items.find((i) => i.ingredientId === fx.wineId)!;
    const flour = items.find((i) => i.ingredientId === fx.flourId)!;
    expect(wine.onHand).toBe(3);
    expect(wine.parLevel).toBe(8);
    expect(wine.suggestedOrderQty).toBe(5); // par 8 - on-hand 3
    expect(wine.belowPar).toBe(true);
    expect(wine.unitCost).toBe(15); // preferred_unit_cost (T10)
    expect(wine.supplierMinOrderQty).toBe(2); // real supplier minimum (T7)
    expect(wine.purchaseUnit).toBe("case");
    expect(wine.packQty).toBe(12);
    // The number the PO is actually placed with. 5 bottles short, bought by the
    // case of 12 -> 1 case. Asserting packQty and suggestedOrderQty without
    // asserting THIS is what let "50 bag" of flour reach a live PO.
    expect(wine.suggestedPackages).toBe(1);
    expect(flour.suggestedPackages).toBeNull(); // no packaging -> order in the kitchen unit
  });

  it("exposes the supplier's real minimum in the catalogue list too", async () => {
    // activeOnly:false because this fixture has no location_ingredient override row.
    const rows = await listLocationIngredients(fx.locId, fx.orgId, { activeOnly: false });
    const wine = rows.find((r) => r.ingredientId === fx.wineId);
    expect(wine).toBeTruthy();
    // Resolved via the preferred supplier (set by the ingredient_supplier trigger),
    // NOT location_ingredient.reorder_qty — that conflation was the original bug.
    expect(Number(wine!.supplierMinOrderQty)).toBe(2);
  });

  it("drops a soft-deleted ingredient from the guide render (T11)", async () => {
    // Item was added while active; now soft-delete it.
    await db.update(ingredient).set({ deletedAt: new Date() }).where(eq(ingredient.ingredientId, fx.flourId));

    const items = await getGuideItems(fx.guideId, fx.orgId, fx.locId);
    expect(items.some((i) => i.ingredientId === fx.flourId)).toBe(false);
    expect(items.some((i) => i.ingredientId === fx.wineId)).toBe(true);
  });
});
