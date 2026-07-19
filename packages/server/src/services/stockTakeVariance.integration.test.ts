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
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
} from "../db/schema.js";
import {
  openSession,
  claimCategory,
  saveLineItem,
  getSessionDetail,
  getCategoryLines,
  getApprovedSessions,
  getPendingReviewSessions,
} from "./stockTakeService.js";

/**
 * The property under test: a stock-take line's expected qty is the current BOOK
 * on-hand (stock_level), and variance = counted − book. This is the fix for
 * variance showing "—" on a first count (the old code compared to the previous
 * approved count, which doesn't exist on a first count).
 *
 * Gated on TENANT_IT=1 (repo's real-DB gate). Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `stv_${Date.now().toString(36)}`,
  userId: 0,
  orgId: 0,
  locId: "",
  wineId: "",
  sessionId: "",
  categoryId: "",
};

describe.skipIf(!RUN)("stock take variance = counted − book on-hand (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "STV IT", userEmail: `${fx.tag}@it.test` })
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
        inventoryActive: true, // openSession requires opening inventory done
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: fx.wineId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId,
        ingredientName: `${fx.tag}-shiraz`,
        ingredientCategory: "spirits",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "bottle",
        contentQty: "750",
        contentUnit: "ml",
      })
      .returning({ id: ingredient.ingredientId });

    // WAC = $15/bottle — the per-counting-unit cost the variance $ value uses.
    await db.insert(locationIngredient).values({
      ingredientId: fx.wineId,
      storeLocationId: fx.locId,
      activeInd: true,
      weightedAverageCost: "15",
    });

    // BOOK on-hand = 8 bottles — the number the count is measured against.
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.wineId, currentQty: "8" });

    const session = await openSession(fx.locId, fx.orgId, fx.userId, ["spirits"]);
    fx.sessionId = session.sessionId;
    const detail = await getSessionDetail(fx.sessionId, fx.orgId);
    fx.categoryId = detail!.categories.find((c) => c.categoryName === "spirits")!.categoryId;
    await claimCategory(fx.sessionId, "spirits", fx.userId);
  });

  afterAll(async () => {
    if (fx.categoryId) await db.delete(stockTakeLine).where(eq(stockTakeLine.categoryId, fx.categoryId));
    if (fx.sessionId) {
      await db.delete(stockTakeCategory).where(eq(stockTakeCategory.sessionId, fx.sessionId));
      await db.delete(stockTakeSession).where(eq(stockTakeSession.sessionId, fx.sessionId));
    }
    if (fx.locId) {
      await db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, [fx.locId]));
      await db.delete(locationIngredient).where(inArray(locationIngredient.storeLocationId, [fx.locId]));
    }
    if (fx.wineId) await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.wineId));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    if (fx.userId) await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("counts 16 against a book of 8 → expected 8, variance +8", async () => {
    await saveLineItem(fx.categoryId, fx.wineId, 16, "bottle", fx.userId);

    const [line] = await db
      .select({
        countedQty: stockTakeLine.countedQty,
        expectedQty: stockTakeLine.expectedQty,
        varianceQty: stockTakeLine.varianceQty,
      })
      .from(stockTakeLine)
      .where(and(eq(stockTakeLine.categoryId, fx.categoryId), eq(stockTakeLine.ingredientId, fx.wineId)));

    expect(Number(line.countedQty)).toBe(16);
    expect(Number(line.expectedQty)).toBe(8);
    expect(Number(line.varianceQty)).toBe(8);

    // getCategoryLines exposes the per-counting-unit cost so review can value the
    // variance: variance × unitCost = 8 × $15 = $120 (computed at display, not stored).
    const [reviewLine] = await getCategoryLines(fx.categoryId);
    expect(Number(reviewLine.unitCost)).toBe(15);
    expect(Number(reviewLine.varianceQty) * Number(reviewLine.unitCost)).toBe(120);
  });

  it("approved sessions appear in history (with approver), not in the pending list", async () => {
    // Flip the fixture session to APPROVED — this tests the history/pending query
    // filters, not the full approve flow (which mutates stock levels).
    await db
      .update(stockTakeSession)
      .set({ sessionStatus: "APPROVED", approvedByUserId: fx.userId, closedDttm: new Date() })
      .where(eq(stockTakeSession.sessionId, fx.sessionId));

    const history = await getApprovedSessions(fx.orgId);
    const pending = await getPendingReviewSessions(fx.orgId);

    const inHistory = history.find((s) => s.sessionId === fx.sessionId);
    expect(inHistory).toBeTruthy();
    expect(inHistory!.approvedByUserName).toBe("STV IT");
    expect(pending.some((s) => s.sessionId === fx.sessionId)).toBe(false);
  });
});
