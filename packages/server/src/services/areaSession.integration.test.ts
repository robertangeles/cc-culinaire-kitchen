import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see stockTakeVariance.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  storageArea,
  ingredientStorageArea,
  ingredient,
  locationIngredient,
  stockLevel,
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  auditLog,
} from "../db/schema.js";
import {
  openSession,
  claimCategory,
  submitCategory,
  saveLineItem,
  approveSession,
  getSessionDetail,
  ConflictError,
  ValidationError,
} from "./stockTakeService.js";
import { setAreaItems } from "./storageAreaService.js";

/**
 * Mobile release 1, PR 1 (E1): counting a stock take by storage area (X1, CEO-D18).
 * Rules under test: eng D3 (closed set of areas; advance only when every area is submitted),
 * D8 (shared items must be counted on each area's own sheet; zero counts), D9 (no item-list
 * edits while an area count is open). Gated on TENANT_IT=1. Self-cleaning.
 *
 * Fixture: Bar and Stock Room share Shiraz; Kitchen holds Flour; Salt is in no area.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `ars_${Date.now().toString(36)}`,
  userA: 0,
  userB: 0,
  orgId: 0,
  locId: "",
  areaIds: {} as Record<string, string>,
  ing: {} as Record<string, string>,
  sessionIds: [] as string[],
};

async function closeSession(sessionId: string) {
  const cats = await db.select({ id: stockTakeCategory.categoryId }).from(stockTakeCategory).where(eq(stockTakeCategory.sessionId, sessionId));
  if (cats.length) await db.delete(stockTakeLine).where(inArray(stockTakeLine.categoryId, cats.map((c) => c.id)));
  await db.delete(stockTakeCategory).where(eq(stockTakeCategory.sessionId, sessionId));
  await db.delete(stockTakeSession).where(eq(stockTakeSession.sessionId, sessionId));
}

async function categoryId(sessionId: string, name: string) {
  const d = await getSessionDetail(sessionId, fx.orgId);
  return d!.categories.find((c) => c.categoryName === name)!.categoryId;
}

async function sessionStatus(sessionId: string) {
  const [s] = await db.select({ s: stockTakeSession.sessionStatus }).from(stockTakeSession).where(eq(stockTakeSession.sessionId, sessionId));
  return s.s;
}

describe.skipIf(!RUN)("stock take by storage area (real DB)", () => {
  beforeAll(async () => {
    [{ id: fx.userA }, { id: fx.userB }] = await db
      .insert(user)
      .values([
        { userName: "ARS A", userEmail: `${fx.tag}-a@it.test` },
        { userName: "ARS B", userEmail: `${fx.tag}-b@it.test` },
      ])
      .returning({ id: user.userId });

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userA })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values({ userId: fx.userA, organisationId: fx.orgId, role: "admin" });

    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-s`.slice(0, 25),
        createdBy: fx.userA,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });

    for (const [i, name] of ["Bar", "Stock Room", "Kitchen"].entries()) {
      const [{ id }] = await db
        .insert(storageArea)
        .values({ organisationId: fx.orgId, storeLocationId: fx.locId, areaName: name, sortOrder: i })
        .returning({ id: storageArea.storageAreaId });
      fx.areaIds[name] = id;
    }

    for (const [name, category] of [["Shiraz", "spirits"], ["Flour", "dry_goods"], ["Salt", "dry_goods"]] as const) {
      const [{ id }] = await db
        .insert(ingredient)
        .values({
          organisationId: fx.orgId,
          ingredientName: `${fx.tag}-${name}`,
          ingredientCategory: category,
          itemType: "KITCHEN_INGREDIENT",
          baseUnit: "kg",
        })
        .returning({ id: ingredient.ingredientId });
      fx.ing[name] = id;
      await db.insert(locationIngredient).values({ ingredientId: id, storeLocationId: fx.locId, activeInd: true });
      await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: id, currentQty: "1" });
    }

    await db.insert(ingredientStorageArea).values([
      { ingredientId: fx.ing.Shiraz, storageAreaId: fx.areaIds.Bar },
      { ingredientId: fx.ing.Shiraz, storageAreaId: fx.areaIds["Stock Room"] },
      { ingredientId: fx.ing.Flour, storageAreaId: fx.areaIds.Kitchen },
    ]);
  });

  afterAll(async () => {
    const sessions = await db.select({ id: stockTakeSession.sessionId }).from(stockTakeSession).where(eq(stockTakeSession.storeLocationId, fx.locId));
    for (const s of sessions) await closeSession(s.id);
    await db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, [fx.locId]));
    await db.delete(locationIngredient).where(inArray(locationIngredient.storeLocationId, [fx.locId]));
    await db.delete(ingredientStorageArea).where(inArray(ingredientStorageArea.storageAreaId, Object.values(fx.areaIds)));
    await db.delete(storageArea).where(eq(storageArea.storeLocationId, fx.locId));
    await db.delete(ingredient).where(eq(ingredient.organisationId, fx.orgId));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
    await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    await db.delete(user).where(inArray(user.userId, [fx.userA, fx.userB]));
  });

  it("opens with every area in sheet order plus Unassigned, as an AREA session", async () => {
    const s = await openSession(fx.locId, fx.orgId, fx.userA, undefined, "AREA");
    expect(s.countMode).toBe("AREA");
    expect(s.categories.map((c) => c.categoryName).sort()).toEqual(["Bar", "Kitchen", "Stock Room", "Unassigned"]);
    await closeSession(s.sessionId);
  });

  it("rejects a split pair with a 409 message and leaves no session behind", async () => {
    await expect(openSession(fx.locId, fx.orgId, fx.userA, ["Bar"], "AREA")).rejects.toThrow(ConflictError);
    await expect(openSession(fx.locId, fx.orgId, fx.userA, ["Bar"], "AREA")).rejects.toThrow(/Stock Room/);
    const left = await db.select().from(stockTakeSession).where(eq(stockTakeSession.storeLocationId, fx.locId));
    expect(left).toHaveLength(0);
  });

  it("rejects an unknown area name", async () => {
    await expect(openSession(fx.locId, fx.orgId, fx.userA, ["Cellar"], "AREA")).rejects.toThrow(ValidationError);
  });

  it("accepts a closed subset and a category count is unchanged", async () => {
    const kitchen = await openSession(fx.locId, fx.orgId, fx.userA, ["Kitchen"], "AREA");
    expect(kitchen.categories.map((c) => c.categoryName)).toEqual(["Kitchen"]);
    await closeSession(kitchen.sessionId);

    const cat = await openSession(fx.locId, fx.orgId, fx.userA, ["dairy"]);
    expect(cat.countMode).toBe("CATEGORY");
    expect(cat.categories.map((c) => c.categoryName)).toEqual(["dairy"]);
    await closeSession(cat.sessionId);
  });

  it("area counts: two chefs claim different areas, D8 blocks a skipped shared item, zero counts, D3 holds the session until every area is submitted", async () => {
    const s = await openSession(fx.locId, fx.orgId, fx.userA, ["Bar", "Stock Room"], "AREA");
    fx.sessionIds.push(s.sessionId);
    const bar = await categoryId(s.sessionId, "Bar");
    const room = await categoryId(s.sessionId, "Stock Room");

    // Two chefs on different areas.
    await claimCategory(s.sessionId, "Bar", fx.userA);
    await claimCategory(s.sessionId, "Stock Room", fx.userB);

    // D8: Shiraz is in both areas; submitting Stock Room without counting it is blocked, with the item named.
    await expect(submitCategory(s.sessionId, "Stock Room")).rejects.toThrow(ValidationError);
    await expect(submitCategory(s.sessionId, "Stock Room")).rejects.toThrow(/Shiraz/);

    // Zero is a count.
    await saveLineItem(room, fx.ing.Shiraz, 0, "kg", fx.userB);
    await saveLineItem(bar, fx.ing.Shiraz, 3, "kg", fx.userA);
    await submitCategory(s.sessionId, "Bar");

    // D3: Stock Room is claimed but not submitted, so the session must not advance.
    expect(await sessionStatus(s.sessionId)).toBe("OPEN");
    await submitCategory(s.sessionId, "Stock Room");
    expect(await sessionStatus(s.sessionId)).toBe("PENDING_REVIEW");
  });

  it("D4: a line for an item in two areas stores no variance; single-area and category lines still do", async () => {
    await closeSession(fx.sessionIds.pop()!);
    const s = await openSession(fx.locId, fx.orgId, fx.userA, undefined, "AREA");
    fx.sessionIds.push(s.sessionId);
    const bar = await categoryId(s.sessionId, "Bar");
    const kitchen = await categoryId(s.sessionId, "Kitchen");

    const shared = await saveLineItem(bar, fx.ing.Shiraz, 3, "kg", fx.userA); // in Bar and Stock Room, book 1
    expect(shared.varianceQty).toBeNull();
    expect(shared.variancePct).toBeNull();
    expect(Number(shared.expectedQty)).toBe(1); // the book stays on the line for the total comparison

    const single = await saveLineItem(kitchen, fx.ing.Flour, 3, "kg", fx.userA); // Kitchen only, book 1
    expect(Number(single.varianceQty)).toBe(2);

    await closeSession(s.sessionId);
    fx.sessionIds.pop();
    const cat = await openSession(fx.locId, fx.orgId, fx.userA, ["spirits"]);
    fx.sessionIds.push(cat.sessionId);
    const spirits = await categoryId(cat.sessionId, "spirits");
    const plain = await saveLineItem(spirits, fx.ing.Shiraz, 3, "kg", fx.userA);
    expect(Number(plain.varianceQty)).toBe(2); // category sessions are unchanged
  });

  it("D3: an AREA session stays open while a listed area was never started (a category count would advance)", async () => {
    // The previous session is PENDING_REVIEW; close it to open a fresh one.
    await closeSession(fx.sessionIds.pop()!);
    const s = await openSession(fx.locId, fx.orgId, fx.userA, ["Bar", "Stock Room"], "AREA");
    fx.sessionIds.push(s.sessionId);
    const bar = await categoryId(s.sessionId, "Bar");
    await claimCategory(s.sessionId, "Bar", fx.userA);
    await saveLineItem(bar, fx.ing.Shiraz, 3, "kg", fx.userA);
    await submitCategory(s.sessionId, "Bar");
    expect(await sessionStatus(s.sessionId)).toBe("OPEN");
  });

  it("D9: item lists cannot be edited while an area count is open, and can be after approval", async () => {
    await closeSession(fx.sessionIds.pop()!);
    const s = await openSession(fx.locId, fx.orgId, fx.userA, ["Bar", "Stock Room"], "AREA");
    fx.sessionIds.push(s.sessionId);

    await expect(setAreaItems(fx.areaIds.Kitchen, fx.orgId, [{ ingredientId: fx.ing.Flour }])).rejects.toMatchObject({ statusCode: 409 });

    // Count to completion, review, approve; then the edit is allowed again.
    const bar = await categoryId(s.sessionId, "Bar");
    const room = await categoryId(s.sessionId, "Stock Room");
    await claimCategory(s.sessionId, "Bar", fx.userA);
    await claimCategory(s.sessionId, "Stock Room", fx.userA);
    await saveLineItem(bar, fx.ing.Shiraz, 3, "kg", fx.userA);
    await saveLineItem(room, fx.ing.Shiraz, 4, "kg", fx.userA);
    await submitCategory(s.sessionId, "Bar");
    await submitCategory(s.sessionId, "Stock Room");
    expect(await sessionStatus(s.sessionId)).toBe("PENDING_REVIEW");

    await expect(setAreaItems(fx.areaIds.Kitchen, fx.orgId, [{ ingredientId: fx.ing.Flour }])).rejects.toMatchObject({ statusCode: 409 });

    await approveSession(s.sessionId, fx.userA, fx.orgId);

    // The item in two areas is summed: 3 + 4.
    const [level] = await db
      .select({ q: stockLevel.currentQty })
      .from(stockLevel)
      .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.ing.Shiraz)));
    expect(Number(level.q)).toBe(7);

    await expect(setAreaItems(fx.areaIds.Kitchen, fx.orgId, [{ ingredientId: fx.ing.Flour }])).resolves.toBeTruthy();
  });
});
