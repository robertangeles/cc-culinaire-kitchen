/**
 * Test support for the Wave 2 line-loop integration suites (waste, prep, consumption, movements):
 * one organisation, two locations, and members with different location assignments, built on a real DB.
 */
import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation, user, userOrganisation, storeLocation, userStoreLocation, ingredient, locationIngredient, stockLevel,
  consumptionLog, stockMovement, storageArea, wasteLog, prepSession, prepTask, prepMenuSelection, ingredientCrossUsage,
  menuItem, menuItemIngredient, recipe, auditLog,
} from "../db/schema.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { TokenPayload } from "./authService.js";

export interface LineLoopFx {
  tag: string;
  orgId: number;
  locA: string;
  locB: string;
  /** Members of the organisation. chef and cook work at A; roamer at A and B; stranger only at B. */
  chef: number;
  cook: number;
  roamer: number;
  stranger: number;
  /** Org admin (sees every location). */
  boss: number;
  ingId: string;
  ingNoStockId: string;
  areaA1: string;
  areaA2: string;
}

export const asUser = (sub: number, permissions: string[] = [], roles: string[] = []): TokenPayload => ({ sub, roles, permissions });

export async function createLineLoopFx(tag: string): Promise<LineLoopFx> {
  const ids: Record<string, number> = {};
  for (const key of ["chef", "cook", "roamer", "stranger", "boss"]) {
    [{ id: ids[key] }] = await db.insert(user).values({ userName: `LL ${key}`, userEmail: `${tag}-${key}@it.test` }).returning({ id: user.userId });
  }
  const [{ id: orgId }] = await db
    .insert(organisation)
    .values({ organisationName: `${tag}-org`, joinKey: `${tag}-k`.slice(0, 25), createdBy: ids.boss })
    .returning({ id: organisation.organisationId });
  await db.insert(userOrganisation).values(
    ["chef", "cook", "roamer", "stranger"].map((k) => ({ userId: ids[k], organisationId: orgId, role: "member" })).concat([{ userId: ids.boss, organisationId: orgId, role: "admin" }]),
  );
  const loc = async (n: string) =>
    (await db
      .insert(storeLocation)
      .values({ organisationId: orgId, locationName: `${tag}-${n}`, classification: "branch", storeKey: `${tag}-${n}`.slice(0, 25), createdBy: ids.boss, inventoryActive: true })
      .returning({ id: storeLocation.storeLocationId }))[0].id;
  const locA = await loc("a");
  const locB = await loc("b");
  await db.insert(userStoreLocation).values([
    { userId: ids.chef, storeLocationId: locA },
    { userId: ids.cook, storeLocationId: locA },
    { userId: ids.roamer, storeLocationId: locA },
    { userId: ids.roamer, storeLocationId: locB },
    { userId: ids.stranger, storeLocationId: locB },
  ]);
  const ing = async (n: string, withStock: boolean) => {
    const [{ id }] = await db
      .insert(ingredient)
      .values({ organisationId: orgId, ingredientName: `${tag}-${n}`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: id, storeLocationId: locA, activeInd: true, weightedAverageCost: "2" });
    if (withStock) await db.insert(stockLevel).values({ storeLocationId: locA, ingredientId: id, currentQty: "10" });
    return id;
  };
  const ingId = await ing("flour", true);
  const ingNoStockId = await ing("salt", false);
  const [a1, a2] = await db
    .insert(storageArea)
    .values([
      { organisationId: orgId, storeLocationId: locA, areaName: "Stock Room" },
      { organisationId: orgId, storeLocationId: locA, areaName: "Bar" },
    ])
    .returning({ id: storageArea.storageAreaId });
  return { tag, orgId, locA, locB, ...(ids as Pick<LineLoopFx, "chef" | "cook" | "roamer" | "stranger" | "boss">), ingId, ingNoStockId, areaA1: a1.id, areaA2: a2.id };
}

export async function removeLineLoopFx(fx: LineLoopFx): Promise<void> {
  const users = [fx.chef, fx.cook, fx.roamer, fx.stranger, fx.boss];
  const sessions = (await db.select({ id: prepSession.prepSessionId }).from(prepSession).where(inArray(prepSession.userId, users))).map((r) => r.id);
  if (sessions.length) {
    await db.delete(ingredientCrossUsage).where(inArray(ingredientCrossUsage.prepSessionId, sessions));
    await db.delete(prepTask).where(inArray(prepTask.prepSessionId, sessions));
    await db.delete(prepMenuSelection).where(inArray(prepMenuSelection.prepSessionId, sessions));
    await db.delete(prepSession).where(inArray(prepSession.prepSessionId, sessions));
  }
  const items = (await db.select({ id: menuItem.menuItemId }).from(menuItem).where(inArray(menuItem.userId, users))).map((r) => r.id);
  if (items.length) {
    await db.delete(menuItemIngredient).where(inArray(menuItemIngredient.menuItemId, items));
    await db.delete(menuItem).where(inArray(menuItem.menuItemId, items));
  }
  await db.delete(recipe).where(inArray(recipe.userId, users));
  await db.delete(wasteLog).where(inArray(wasteLog.userId, users));
  await db.delete(consumptionLog).where(eq(consumptionLog.organisationId, fx.orgId));
  await db.delete(stockMovement).where(eq(stockMovement.organisationId, fx.orgId));
  await db.delete(storageArea).where(eq(storageArea.organisationId, fx.orgId));
  for (const id of [fx.ingId, fx.ingNoStockId]) {
    await db.delete(stockLevel).where(eq(stockLevel.ingredientId, id));
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, id));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, id));
  }
  await db.delete(userStoreLocation).where(inArray(userStoreLocation.userId, users));
  await db.update(user).set({ selectedLocationId: null }).where(inArray(user.userId, users));
  await db.delete(storeLocation).where(eq(storeLocation.organisationId, fx.orgId));
  await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
  await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
  await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
  await db.delete(user).where(inArray(user.userId, users));
}

export interface Answer {
  status: number;
  /** The JSON the handler sent; tests read fields off it. */
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Runs an Express handler the way the router would, with the real error handler behind it. */
export function callHandler(
  handler: (req: Request, res: Response, next: (e?: unknown) => void) => unknown,
  user: TokenPayload,
  parts: { params?: object; body?: object; query?: object } = {},
): Promise<Answer> {
  return new Promise<Answer>((resolveCall) => {
    let status = 200;
    const res = {
      headersSent: false,
      status(code: number) {
        status = code;
        return this;
      },
      json(b: unknown) {
        resolveCall({ status, body: b });
        return this;
      },
    } as unknown as Response;
    const next = (e?: unknown) => errorHandler(e as Error, {} as Request, res, () => {});
    // Express 5 hands a rejected handler to the error handler; do the same.
    Promise.resolve(handler({ user, params: parts.params ?? {}, body: parts.body ?? {}, query: parts.query ?? {} } as unknown as Request, res, next)).catch(next);
  });
}
