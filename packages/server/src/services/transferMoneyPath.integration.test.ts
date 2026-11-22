import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

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
  inventoryTransfer,
  inventoryTransferLine,
  fifoBatch,
  stockMovement,
  auditLog,
} from "../db/schema.js";
import * as transferService from "./transferService.js";

/**
 * Transfers, real DB: a location from another organisation is refused, a send runs once
 * even when two arrive together, and a send that fails half way leaves nothing behind.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `tmp_${Date.now().toString(36)}`,
  userId: 0,
  orgA: 0,
  orgB: 0,
  locA1: "",
  locA2: "",
  locB1: "",
  ingId: "",
  ingEachId: "",
  transferIds: [] as string[],
};

async function qty(locId: string, ingredientId: string) {
  const [row] = await db
    .select({ qty: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, locId), eq(stockLevel.ingredientId, ingredientId)));
  return row ? Number(row.qty) : 0;
}

async function newTransfer(lines: Array<{ ingredientId: string; sentQty: number; sentUnit: string }>) {
  const t = await transferService.initiateTransfer(fx.orgA, fx.locA1, fx.locA2, fx.userId, lines);
  fx.transferIds.push(t.transferId);
  return t;
}

async function statusOf(transferId: string) {
  const [row] = await db.select({ s: inventoryTransfer.status }).from(inventoryTransfer).where(eq(inventoryTransfer.transferId, transferId));
  return row.s;
}

describe.skipIf(!RUN)("transfer money path (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "TMP IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });
    for (const key of ["orgA", "orgB"] as const) {
      [{ id: fx[key] }] = await db
        .insert(organisation)
        .values({ organisationName: `${fx.tag}-${key}`, joinKey: `${fx.tag}-${key}`.slice(0, 25), createdBy: fx.userId })
        .returning({ id: organisation.organisationId });
    }
    for (const [key, orgId] of [["locA1", fx.orgA], ["locA2", fx.orgA], ["locB1", fx.orgB]] as const) {
      [{ id: fx[key] }] = await db
        .insert(storeLocation)
        .values({
          organisationId: orgId,
          locationName: `${fx.tag}-${key}`,
          classification: "branch",
          storeKey: `${fx.tag}-${key}`.slice(0, 25),
          createdBy: fx.userId,
          inventoryActive: true,
        })
        .returning({ id: storeLocation.storeLocationId });
    }
    for (const [key, unit] of [["ingId", "kg"], ["ingEachId", "each"]] as const) {
      [{ id: fx[key] }] = await db
        .insert(ingredient)
        .values({
          organisationId: fx.orgA,
          ingredientName: `${fx.tag}-${unit}`,
          ingredientCategory: "dry_goods",
          itemType: "KITCHEN_INGREDIENT",
          baseUnit: unit,
        })
        .returning({ id: ingredient.ingredientId });
      for (const locId of [fx.locA1, fx.locA2]) {
        await db.insert(locationIngredient).values({ ingredientId: fx[key], storeLocationId: locId, activeInd: true, weightedAverageCost: "2" });
        await db.insert(stockLevel).values({ storeLocationId: locId, ingredientId: fx[key], currentQty: "10" });
      }
    }
  });

  afterAll(async () => {
    const ingIds = [fx.ingId, fx.ingEachId].filter(Boolean);
    if (fx.transferIds.length) {
      await db.delete(fifoBatch).where(inArray(fifoBatch.sourceTransferId, fx.transferIds));
      await db.delete(inventoryTransferLine).where(inArray(inventoryTransferLine.transferId, fx.transferIds));
      await db.delete(inventoryTransfer).where(inArray(inventoryTransfer.transferId, fx.transferIds));
    }
    if (ingIds.length) {
      await db.delete(stockMovement).where(inArray(stockMovement.ingredientId, ingIds));
      await db.delete(stockLevel).where(inArray(stockLevel.ingredientId, ingIds));
      await db.delete(locationIngredient).where(inArray(locationIngredient.ingredientId, ingIds));
      await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    }
    for (const locId of [fx.locA1, fx.locA2, fx.locB1].filter(Boolean)) {
      await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locId));
    }
    for (const orgId of [fx.orgA, fx.orgB].filter(Boolean)) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    }
    if (fx.userId) await db.delete(user).where(eq(user.userId, fx.userId));
  });

  it("refuses a destination location that belongs to another organisation", async () => {
    await expect(
      transferService.initiateTransfer(fx.orgA, fx.locA1, fx.locB1, fx.userId, [{ ingredientId: fx.ingId, sentQty: 1, sentUnit: "kg" }]),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses a source location that belongs to another organisation", async () => {
    await expect(
      transferService.initiateTransfer(fx.orgA, fx.locB1, fx.locA2, fx.userId, [{ ingredientId: fx.ingId, sentQty: 1, sentUnit: "kg" }]),
    ).rejects.toThrow(/not found/i);
  });

  it("two sends at once take the stock from the source once", async () => {
    const t = await newTransfer([{ ingredientId: fx.ingId, sentQty: 3, sentUnit: "kg" }]);
    const before = await qty(fx.locA1, fx.ingId);

    const results = await Promise.allSettled([
      transferService.confirmSent(t.transferId, fx.orgA, fx.userId),
      transferService.confirmSent(t.transferId, fx.orgA, fx.userId),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await qty(fx.locA1, fx.ingId)).toBe(before - 3);
    expect(await statusOf(t.transferId)).toBe("SENT");
  });

  it("two receives at once add the stock at the destination once", async () => {
    const t = await newTransfer([{ ingredientId: fx.ingId, sentQty: 2, sentUnit: "kg" }]);
    await transferService.confirmSent(t.transferId, fx.orgA, fx.userId);
    const before = await qty(fx.locA2, fx.ingId);

    const results = await Promise.allSettled([
      transferService.confirmReceived(t.transferId, fx.orgA, fx.userId, []),
      transferService.confirmReceived(t.transferId, fx.orgA, fx.userId, []),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await qty(fx.locA2, fx.ingId)).toBe(before + 2);
  });

  it("a send that fails on its second line leaves the first line's stock and the status untouched", async () => {
    // 1 kg of a kg item, then 1 kg of an each-counted item: kg cannot convert to each.
    const t = await newTransfer([
      { ingredientId: fx.ingId, sentQty: 1, sentUnit: "kg" },
      { ingredientId: fx.ingEachId, sentQty: 1, sentUnit: "kg" },
    ]);
    const before = await qty(fx.locA1, fx.ingId);

    await expect(transferService.confirmSent(t.transferId, fx.orgA, fx.userId)).rejects.toThrow();

    expect(await qty(fx.locA1, fx.ingId)).toBe(before);
    expect(await statusOf(t.transferId)).toBe("INITIATED");
  });
});
