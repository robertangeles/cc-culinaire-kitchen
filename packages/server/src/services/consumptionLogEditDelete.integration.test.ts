import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, storeLocation, ingredient, locationIngredient, stockLevel, consumptionLog, stockMovement, auditLog } from "../db/schema.js";
import { logConsumption } from "./consumptionLogService.js";
import { handleEditLog, handleDeleteLog } from "../controllers/consumptionLogController.js";
import { errorHandler } from "../middleware/errorHandler.js";

/**
 * Editing or deleting a consumption-log entry: the three refusals (no such entry, someone else's
 * entry, older than 24 hours) must answer with their own status and code, not an unmapped 500.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = { tag: `cle_${Date.now().toString(36)}`, owner: 0, other: 0, orgId: 0, locId: "", ingId: "" };

function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>, sub: number, params: object, body: object = {}) {
  return new Promise<{ status: number; body: unknown }>((resolveCall, reject) => {
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
    handler({ user: { sub, roles: [], permissions: [] }, params, body, query: {} } as unknown as Request, res, next).catch(reject);
  });
}

async function newEntry() {
  const entry = await logConsumption(fx.orgId, fx.locId, fx.owner, { ingredientId: fx.ingId, menuItemId: null, quantity: 1, unit: "kg", reason: "spoilage", notes: null, shift: null });
  return entry.consumptionLogId as string;
}

describe.skipIf(!RUN)("consumption log edit/delete refusals (real DB)", () => {
  beforeAll(async () => {
    for (const key of ["owner", "other"] as const) {
      [{ id: fx[key] }] = await db.insert(user).values({ userName: `CLE ${key}`, userEmail: `${fx.tag}-${key}@it.test` }).returning({ id: user.userId });
    }
    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.owner })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([
      { userId: fx.owner, organisationId: fx.orgId, role: "admin" },
      { userId: fx.other, organisationId: fx.orgId, role: "admin" },
    ]);
    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({ organisationId: fx.orgId, locationName: `${fx.tag}-loc`, classification: "branch", storeKey: `${fx.tag}-s`.slice(0, 25), createdBy: fx.owner, inventoryActive: true })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgId, ingredientName: `${fx.tag}-flour`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: fx.ingId, storeLocationId: fx.locId, activeInd: true, weightedAverageCost: "2" });
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.ingId, currentQty: "10" });
  });

  afterAll(async () => {
    await db.delete(consumptionLog).where(eq(consumptionLog.organisationId, fx.orgId));
    await db.delete(stockMovement).where(eq(stockMovement.ingredientId, fx.ingId));
    await db.delete(stockLevel).where(eq(stockLevel.ingredientId, fx.ingId));
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, fx.ingId));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    await db.delete(auditLog).where(eq(auditLog.organisationId, fx.orgId));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
    await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    for (const id of [fx.owner, fx.other]) await db.delete(user).where(eq(user.userId, id));
  });

  it("edit of an unknown entry is 404 NOT_FOUND", async () => {
    const out = await call(handleEditLog, fx.owner, { id: "00000000-0000-4000-8000-000000000000" }, { quantity: 2 });
    expect(out.status).toBe(404);
    expect(out.body).toMatchObject({ code: "NOT_FOUND" });
  });

  // A repeat of a delete that already happened must succeed (the phone resends until it hears back).
  it("delete of an entry that is gone is a success", async () => {
    const out = await call(handleDeleteLog, fx.owner, { id: "00000000-0000-4000-8000-000000000000" });
    expect(out).toMatchObject({ status: 200, body: { success: true } });
  });

  it.each([
    ["edit", handleEditLog],
    ["delete", handleDeleteLog],
  ] as const)("%s of someone else's entry is 403 FORBIDDEN", async (_n, handler) => {
    const id = await newEntry();
    const out = await call(handler, fx.other, { id }, { quantity: 2 });
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["edit", handleEditLog],
    ["delete", handleDeleteLog],
  ] as const)("%s of an entry older than 24 hours is 409 EDIT_WINDOW_EXPIRED", async (_n, handler) => {
    const id = await newEntry();
    await db.update(consumptionLog).set({ loggedAt: new Date(Date.now() - 25 * 3600 * 1000) }).where(eq(consumptionLog.consumptionLogId, id));
    const out = await call(handler, fx.owner, { id }, { quantity: 2 });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: "EDIT_WINDOW_EXPIRED" });
  });
});
