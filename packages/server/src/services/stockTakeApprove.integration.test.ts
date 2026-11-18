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
  storeLocation,
  ingredient,
  locationIngredient,
  stockLevel,
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
  auditLog,
} from "../db/schema.js";
import { openSession, claimCategory, submitCategory, saveLineItem, approveSession, getSessionDetail } from "./stockTakeService.js";

/**
 * Regression: approving a stock take wrote stock_level with ON CONFLICT (location, ingredient),
 * but the FOH feature made the unique index (location, ingredient, zone), so Postgres rejected
 * the upsert ("no unique or exclusion constraint matching the ON CONFLICT specification") and
 * no stock take could be approved. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";
const fx = { tag: `sta_${Date.now().toString(36)}`, userId: 0, orgId: 0, locId: "", ingId: "", sessionId: "" };

describe.skipIf(!RUN)("approving a stock take updates stock under the zone-aware unique index (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db.insert(user).values({ userName: "STA IT", userEmail: `${fx.tag}@it.test` }).returning({ userId: user.userId });
    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.userId })
      .returning({ id: organisation.organisationId });
    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({ organisationId: fx.orgId, locationName: `${fx.tag}-loc`, classification: "branch", storeKey: `${fx.tag}-s`.slice(0, 25), createdBy: fx.userId, inventoryActive: true })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgId, ingredientName: `${fx.tag}-oil`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: fx.ingId, storeLocationId: fx.locId, activeInd: true });
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.ingId, currentQty: "1" });
  });

  afterAll(async () => {
    const cats = fx.sessionId ? await db.select({ id: stockTakeCategory.categoryId }).from(stockTakeCategory).where(eq(stockTakeCategory.sessionId, fx.sessionId)) : [];
    if (cats.length) await db.delete(stockTakeLine).where(inArray(stockTakeLine.categoryId, cats.map((c) => c.id)));
    if (fx.sessionId) {
      await db.delete(stockTakeCategory).where(eq(stockTakeCategory.sessionId, fx.sessionId));
      await db.delete(stockTakeSession).where(eq(stockTakeSession.sessionId, fx.sessionId));
    }
    await db.delete(stockLevel).where(inArray(stockLevel.storeLocationId, [fx.locId]));
    await db.delete(locationIngredient).where(inArray(locationIngredient.storeLocationId, [fx.locId]));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
    await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("approve overwrites the BOH stock level with the counted quantity", async () => {
    const s = await openSession(fx.locId, fx.orgId, fx.userId, ["dry_goods"]);
    fx.sessionId = s.sessionId;
    const detail = await getSessionDetail(s.sessionId, fx.orgId);
    const categoryId = detail!.categories.find((c) => c.categoryName === "dry_goods")!.categoryId;
    await claimCategory(s.sessionId, "dry_goods", fx.userId);
    await saveLineItem(categoryId, fx.ingId, 9, "kg", fx.userId);
    await submitCategory(s.sessionId, "dry_goods");

    await approveSession(s.sessionId, fx.userId, fx.orgId);

    const [level] = await db
      .select({ q: stockLevel.currentQty })
      .from(stockLevel)
      .where(and(eq(stockLevel.storeLocationId, fx.locId), eq(stockLevel.ingredientId, fx.ingId), eq(stockLevel.zone, "BOH")));
    expect(Number(level.q)).toBe(9);
  });
});
