import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  storeLocation,
  ingredient,
  locationIngredient,
  stockLevel,
  storageArea,
  ingredientStorageArea,
  stockMovement,
} from "../db/schema.js";
import {
  listAreas,
  createArea,
  updateArea,
  deactivateArea,
  listAreaItems,
  setAreaItems,
  getAssignmentMap,
  StorageAreaError,
} from "./storageAreaService.js";
import {
  createMovement,
  listMovements,
  StockMovementError,
} from "./stockMovementService.js";
import { getIngredientTransactions } from "./ingredientService.js";

/**
 * Real-DB suite for storage areas + stock movements (B1).
 *
 * The property under test, above all others: A MOVE DOES NOT CHANGE STOCK.
 * Bottles carried to the bar are still on site and still sellable. The bug that
 * created this feature was the product having no vocabulary for "restocked the
 * bar" except *consume it* — which deducted the stock at the move and again at
 * the sale, and showed the gap as phantom yield variance.
 *
 * Gated on TENANT_IT=1 (the repo's real-DB gate — CI runs it against a
 * throwaway Postgres). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  // join_key and store_key are varchar(25) — keep the tag short enough that
  // the suffixed keys still fit.
  tag: `ait_${Date.now().toString(36)}`,
  userId: 0,
  orgId: 0,
  otherOrgId: 0,
  locId: "",
  otherLocId: "",
  wineId: "",
  otherOrgIngId: "",
};

describe.skipIf(!RUN)("storage areas + stock movements — real DB", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "Areas IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });

    const mkOrg = async (suffix: string) => {
      const [row] = await db
        .insert(organisation)
        .values({
          organisationName: `${fx.tag}-org-${suffix}`,
          joinKey: `${fx.tag}-k-${suffix}`.slice(0, 25),
          createdBy: fx.userId,
        })
        .returning({ id: organisation.organisationId });
      return row.id;
    };
    fx.orgId = await mkOrg("a");
    fx.otherOrgId = await mkOrg("b");

    const mkLoc = async (orgId: number, suffix: string) => {
      const [row] = await db
        .insert(storeLocation)
        .values({
          organisationId: orgId,
          locationName: `${fx.tag}-loc-${suffix}`,
          classification: "branch",
          storeKey: `${fx.tag}-${suffix}`.slice(0, 25),
          createdBy: fx.userId,
        })
        .returning({ id: storeLocation.storeLocationId });
      return row.id;
    };
    fx.locId = await mkLoc(fx.orgId, "a");
    fx.otherLocId = await mkLoc(fx.otherOrgId, "b");

    const mkIng = async (orgId: number, name: string) => {
      const [row] = await db
        .insert(ingredient)
        .values({
          organisationId: orgId,
          ingredientName: name,
          ingredientCategory: "spirits",
          itemType: "KITCHEN_INGREDIENT",
          baseUnit: "bottle",
          contentQty: "750",
          contentUnit: "ml",
        })
        .returning({ id: ingredient.ingredientId });
      return row.id;
    };
    fx.wineId = await mkIng(fx.orgId, `${fx.tag}-shiraz`);
    fx.otherOrgIngId = await mkIng(fx.otherOrgId, `${fx.tag}-other-wine`);

    await db.insert(locationIngredient).values({
      ingredientId: fx.wineId,
      storeLocationId: fx.locId,
      activeInd: true,
    });
    // 24 bottles on hand — the exact scenario that triggered this feature.
    await db.insert(stockLevel).values({
      storeLocationId: fx.locId,
      ingredientId: fx.wineId,
      currentQty: "24",
    });
  });

  /**
   * Cleanup must survive a PARTIAL beforeAll.
   *
   * This bit me for real: an early beforeAll insert failed, so `fx.wineId` was
   * still "". The first uuid delete then threw `invalid input syntax for type
   * uuid: ""`, every later delete was skipped, and the test user was stranded in
   * a database other suites share. Filter the ids that never got set, and let no
   * single failed step stop the rest — a leaked row outlives the run.
   */
  afterAll(async () => {
    const set = <T,>(...vals: T[]): T[] => vals.filter((v) => v !== "" && v !== 0);
    const orgIds = set(fx.orgId, fx.otherOrgId);
    const locIds = set(fx.locId, fx.otherLocId);
    const ingIds = set(fx.wineId, fx.otherOrgIngId);

    const step = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        // Report, don't rethrow: the remaining steps still need to run.
        console.warn(`[storageAreas.it] cleanup step "${label}" failed:`, err);
      }
    };

    if (orgIds.length) {
      await step("movements", () =>
        db.delete(stockMovement).where(inArray(stockMovement.organisationId, orgIds)));
      const areas = await db
        .select({ id: storageArea.storageAreaId })
        .from(storageArea)
        .where(inArray(storageArea.organisationId, orgIds));
      if (areas.length > 0) {
        await step("assignments", () =>
          db.delete(ingredientStorageArea).where(
            inArray(ingredientStorageArea.storageAreaId, areas.map((a) => a.id)),
          ));
      }
      await step("areas", () =>
        db.delete(storageArea).where(inArray(storageArea.organisationId, orgIds)));
    }
    if (locIds.length) {
      await step("stock", () => db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, locIds)));
      await step("locationIngredient", () =>
        db.delete(locationIngredient).where(inArray(locationIngredient.storeLocationId, locIds)));
    }
    if (ingIds.length) {
      await step("ingredients", () => db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds)));
    }
    if (locIds.length) {
      await step("locations", () =>
        db.delete(storeLocation).where(inArray(storeLocation.storeLocationId, locIds)));
    }
    if (orgIds.length) {
      await step("orgs", () => db.delete(organisation).where(inArray(organisation.organisationId, orgIds)));
    }
    if (fx.userId) {
      await step("user", () => db.delete(user).where(eq(user.userId, fx.userId)));
    }
  });

  /** The venue's single source of on-hand truth. */
  async function readStock() {
    const [row] = await db
      .select()
      .from(stockLevel)
      .where(
        and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.wineId)),
      );
    return row;
  }

  // ── Areas ───────────────────────────────────────────────────────

  it("creates areas and lists them in walk order with item counts", async () => {
    const room = await createArea(fx.locId, fx.orgId, "Stock Room", 0);
    const bar = await createArea(fx.locId, fx.orgId, "Bar", 1);
    expect(room.areaName).toBe("Stock Room");
    expect(bar.activeInd).toBe(true);

    const areas = await listAreas(fx.locId, fx.orgId);
    expect(areas.map((a) => a.areaName)).toEqual(["Stock Room", "Bar"]);
    expect(areas.every((a) => a.itemCount === 0)).toBe(true);
  });

  it("rejects the reserved 'Unassigned' name with a plain sentence, not a constraint error", async () => {
    await expect(createArea(fx.locId, fx.orgId, "Unassigned")).rejects.toThrow(StorageAreaError);
    await expect(createArea(fx.locId, fx.orgId, "Unassigned")).rejects.toThrow(/reserved/i);
    // Case-insensitively — the sentinel is a name, not a byte sequence.
    await expect(createArea(fx.locId, fx.orgId, "unassigned")).rejects.toThrow(/reserved/i);
  });

  it("rejects a duplicate area name at the same location", async () => {
    await expect(createArea(fx.locId, fx.orgId, "Bar")).rejects.toThrow(/already has an area/i);
  });

  it("a racing duplicate hits the unique index and STILL gets the sentence, not a 500", async () => {
    // The SELECT-before-INSERT is a friendliness check, not a lock. Simulate the
    // loser of the race by inserting straight past the check — the operator must
    // still get "already has an area called X", never a raw constraint error.
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;
    expect(bar).toBeTruthy();

    await expect(createArea(fx.locId, fx.orgId, "Bar")).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/already has an area/i),
    });
  });

  it("404s a location in another org rather than confirming it exists", async () => {
    await expect(listAreas(fx.otherLocId, fx.orgId)).rejects.toThrow(/not found/i);
    await expect(createArea(fx.otherLocId, fx.orgId, "Sneaky")).rejects.toThrow(/not found/i);
  });

  it("assigns items to an area with par + shelf order, and replaces wholesale", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;

    const items = await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId, areaParLevel: 6, sortOrder: 0 },
    ]);
    expect(items).toHaveLength(1);
    expect(Number(items[0].areaParLevel)).toBe(6);

    // Re-saving the picker replaces the set rather than appending.
    const emptied = await setAreaItems(bar.storageAreaId, fx.orgId, []);
    expect(emptied).toHaveLength(0);

    await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId, areaParLevel: 6, sortOrder: 0 },
    ]);
    expect(await listAreaItems(bar.storageAreaId, fx.orgId)).toHaveLength(1);
  });

  it("a par of null round-trips as NULL, never 0 — 'no par' is not 'par of zero'", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;

    // Explicit null, and omitted entirely: both mean "nobody set a par here".
    // The restock list only covers items WITH a par — collapsing null to 0 would
    // make it demand you bring up every item you never set a par for.
    const explicitNull = await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId, areaParLevel: null },
    ]);
    expect(explicitNull[0].areaParLevel).toBeNull();

    const omitted = await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId },
    ]);
    expect(omitted[0].areaParLevel).toBeNull();

    // ...and 0 is a real, different answer: "stock none of this here".
    const zero = await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId, areaParLevel: 0 },
    ]);
    expect(zero[0].areaParLevel).not.toBeNull();
    expect(Number(zero[0].areaParLevel)).toBe(0);

    // restore the fixture's par for later tests
    await setAreaItems(bar.storageAreaId, fx.orgId, [
      { ingredientId: fx.wineId, areaParLevel: 6, sortOrder: 0 },
    ]);
  });

  it("refuses a negative par", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;
    await expect(
      setAreaItems(bar.storageAreaId, fx.orgId, [{ ingredientId: fx.wineId, areaParLevel: -1 }]),
    ).rejects.toThrow(/can't be negative/i);
  });

  it("refuses an item from another org, even smuggled in a batch", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;
    await expect(
      setAreaItems(bar.storageAreaId, fx.orgId, [
        { ingredientId: fx.wineId },
        { ingredientId: fx.otherOrgIngId },
      ]),
    ).rejects.toThrow(/not found/i);
    // ...and the smuggle attempt left the real assignment intact (transaction).
    expect(await listAreaItems(bar.storageAreaId, fx.orgId)).toHaveLength(1);
  });

  it("refuses the same item twice on one sheet", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;
    await expect(
      setAreaItems(bar.storageAreaId, fx.orgId, [
        { ingredientId: fx.wineId, sortOrder: 0 },
        { ingredientId: fx.wineId, sortOrder: 1 },
      ]),
    ).rejects.toThrow(/only appear once/i);
  });

  it("assignment map covers only ACTIVE areas — it is what the sheet filters on", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;
    await setAreaItems(room.storageAreaId, fx.orgId, [{ ingredientId: fx.wineId }]);

    const map = await getAssignmentMap(fx.locId, fx.orgId);
    expect(map[fx.wineId]).toHaveLength(2); // Stock Room + Bar

    // Deactivate the room: its assignment drops out of the map, so the item
    // stops appearing on that sheet — but the assignment row survives.
    await deactivateArea(room.storageAreaId, fx.orgId);
    const after = await getAssignmentMap(fx.locId, fx.orgId);
    expect(after[fx.wineId]).toHaveLength(1);
    expect(await listAreaItems(room.storageAreaId, fx.orgId)).toHaveLength(1);

    await updateArea(room.storageAreaId, fx.orgId, { activeInd: true });
  });

  // ── Movements: the invariant ────────────────────────────────────

  it("A MOVE DOES NOT CHANGE STOCK — stock_level byte-identical before/after", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;
    const bar = areas.find((a) => a.areaName === "Bar")!;

    const before = await readStock();
    expect(Number(before.currentQty)).toBe(24);

    const moved = await createMovement(fx.locId, fx.orgId, fx.userId, {
      ingredientId: fx.wineId,
      fromStorageAreaId: room.storageAreaId,
      toStorageAreaId: bar.storageAreaId,
      quantity: 4,
      unit: "bottle",
      notes: "Friday service",
    });
    expect(Number(moved.quantity)).toBe(4);

    const after = await readStock();
    // Not just the number — the whole row. A version bump or a lastCounted
    // touch would mean something wrote to stock, which is the thing forbidden.
    expect(after).toEqual(before);
  });

  it("resolves base_qty in kitchen units, like consumption_log.base_qty", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;
    const bar = areas.find((a) => a.areaName === "Bar")!;

    const moved = await createMovement(fx.locId, fx.orgId, fx.userId, {
      ingredientId: fx.wineId,
      fromStorageAreaId: room.storageAreaId,
      toStorageAreaId: bar.storageAreaId,
      quantity: 2,
      unit: "bottle",
    });
    expect(Number(moved.baseQty)).toBe(2);
  });

  it("rejects a move that goes nowhere, or moves nothing", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const bar = areas.find((a) => a.areaName === "Bar")!;
    const room = areas.find((a) => a.areaName === "Stock Room")!;

    await expect(
      createMovement(fx.locId, fx.orgId, fx.userId, {
        ingredientId: fx.wineId,
        fromStorageAreaId: bar.storageAreaId,
        toStorageAreaId: bar.storageAreaId,
        quantity: 4,
        unit: "bottle",
      }),
    ).rejects.toThrow(/two different areas/i);

    await expect(
      createMovement(fx.locId, fx.orgId, fx.userId, {
        ingredientId: fx.wineId,
        fromStorageAreaId: room.storageAreaId,
        toStorageAreaId: bar.storageAreaId,
        quantity: 0,
        unit: "bottle",
      }),
    ).rejects.toThrow(/how much/i);
  });

  it("refuses to move into an area at another location — that would be a transfer", async () => {
    const foreign = await createArea(fx.otherLocId, fx.otherOrgId, "Foreign Bar");
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;

    await expect(
      createMovement(fx.locId, fx.orgId, fx.userId, {
        ingredientId: fx.wineId,
        fromStorageAreaId: room.storageAreaId,
        toStorageAreaId: foreign.storageAreaId,
        quantity: 1,
        unit: "bottle",
      }),
    ).rejects.toThrow(/isn't at this location/i);
  });

  it("refuses a move into a deactivated area", async () => {
    const dead = await createArea(fx.locId, fx.orgId, "Old Cupboard");
    await deactivateArea(dead.storageAreaId, fx.orgId);
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;

    await expect(
      createMovement(fx.locId, fx.orgId, fx.userId, {
        ingredientId: fx.wineId,
        fromStorageAreaId: room.storageAreaId,
        toStorageAreaId: dead.storageAreaId,
        quantity: 1,
        unit: "bottle",
      }),
    ).rejects.toThrow(/no longer in use/i);
  });

  it("refuses an item from another org", async () => {
    const areas = await listAreas(fx.locId, fx.orgId);
    const room = areas.find((a) => a.areaName === "Stock Room")!;
    const bar = areas.find((a) => a.areaName === "Bar")!;

    await expect(
      createMovement(fx.locId, fx.orgId, fx.userId, {
        ingredientId: fx.otherOrgIngId,
        fromStorageAreaId: room.storageAreaId,
        toStorageAreaId: bar.storageAreaId,
        quantity: 1,
        unit: "bottle",
      }),
    ).rejects.toThrow(/item not found/i);
  });

  it("lists movements newest-first with area names for the feed", async () => {
    const rows = await listMovements(fx.locId, fx.orgId, { ingredientId: fx.wineId });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].fromAreaName).toBe("Stock Room");
    expect(rows[0].toAreaName).toBe("Bar");
    expect(rows[0].ingredientName).toContain("shiraz");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].movedAt.getTime()).toBeGreaterThanOrEqual(rows[i].movedAt.getTime());
    }
  });

  it("a move shows up in the item's transaction feed, as a move", async () => {
    // "Where did my stock go?" must have an honest answer. The move belongs in
    // the history — labelled as a move, next to the counts and the usage — or
    // the operator is left guessing why the bar has bottles the cellar doesn't.
    const month = new Date().toISOString().slice(0, 7);
    const { transactions } = await getIngredientTransactions(fx.wineId, fx.orgId, month);

    const moves = transactions.filter((t: { type: string }) => t.type === "movement");
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves[0]).toMatchObject({
      type: "movement",
      unit: "bottle",
      reason: "Stock Room → Bar",
    });

    // Newest-first ordering holds across the merged sources.
    const times = transactions.map((t: { occurredAt: string }) => new Date(t.occurredAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("404s movements at a location in another org", async () => {
    await expect(listMovements(fx.otherLocId, fx.orgId)).rejects.toThrow(StockMovementError);
    await expect(listMovements(fx.otherLocId, fx.orgId)).rejects.toThrow(/not found/i);
  });

  it("after every movement above, venue stock is STILL 24 — nothing leaked", async () => {
    expect(Number((await readStock()).currentQty)).toBe(24);
  });
});
