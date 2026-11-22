import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, userStoreLocation, storeLocation, ingredient, locationIngredient, stockLevel, consumptionLog, auditLog, menuItem, sale } from "../db/schema.js";
import { recordSale, commitSalesCsv } from "./saleService.js";
import { canAccessLocation, assertLocationAccess } from "./locationContextService.js";
import { handleListLogs, handleLogConsumption } from "../controllers/consumptionLogController.js";
import { handleInitiateTransfer, handleListTransfers } from "../controllers/transferController.js";
import { handleStartSession } from "../controllers/receivingController.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { TokenPayload } from "./authService.js";

/**
 * Location scoping, real DB. A location sent by the client must be one the caller is assigned
 * to (org admins: any location of their organisation; `inventory:hq` holders: oversight of
 * their organisation's locations) — being in the same organisation is not enough.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `lac_${Date.now().toString(36)}`,
  chef: 0,
  admin: 0,
  hq: 0,
  outsider: 0,
  orgA: 0,
  orgB: 0,
  a1: "",
  a2: "",
  b1: "",
  ingId: "",
  menuItemAtA2: "",
};

const principal = (sub: number, permissions: string[] = []): TokenPayload => ({ sub, roles: [], permissions });

function call(handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>, sub: number, req: object, permissions: string[] = []) {
  return new Promise<{ status: number; body: unknown }>((resolveCall, reject) => {
    let status = 200;
    const res = {
      headersSent: false,
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolveCall({ status, body });
        return this;
      },
    } as unknown as Response;
    const next = (e?: unknown) => errorHandler(e as Error, {} as Request, res, () => {});
    handler({ user: principal(sub, permissions), body: {}, query: {}, params: {}, ...req } as unknown as Request, res, next).catch(reject);
  });
}

describe.skipIf(!RUN)("location scoping (real DB)", () => {
  beforeAll(async () => {
    const mkUser = async (n: string) => {
      const [{ id }] = await db.insert(user).values({ userName: `LAC ${n}`, userEmail: `${fx.tag}-${n}@it.test` }).returning({ id: user.userId });
      return id;
    };
    fx.chef = await mkUser("chef");
    fx.admin = await mkUser("admin");
    fx.hq = await mkUser("hq");
    fx.outsider = await mkUser("outsider");
    for (const key of ["orgA", "orgB"] as const) {
      [{ id: fx[key] }] = await db
        .insert(organisation)
        .values({ organisationName: `${fx.tag}-${key}`, joinKey: `${fx.tag}-${key}`.slice(0, 25), createdBy: fx.admin })
        .returning({ id: organisation.organisationId });
    }
    await db.insert(userOrganisation).values([
      { userId: fx.chef, organisationId: fx.orgA, role: "member" },
      { userId: fx.admin, organisationId: fx.orgA, role: "admin" },
      { userId: fx.hq, organisationId: fx.orgA, role: "member" },
      { userId: fx.outsider, organisationId: fx.orgB, role: "admin" },
    ]);
    for (const [key, orgId] of [["a1", fx.orgA], ["a2", fx.orgA], ["b1", fx.orgB]] as const) {
      [{ id: fx[key] }] = await db
        .insert(storeLocation)
        .values({ organisationId: orgId, locationName: `${fx.tag}-${key}`, classification: "branch", storeKey: `${fx.tag}-${key}`.slice(0, 25), createdBy: fx.admin, inventoryActive: true })
        .returning({ id: storeLocation.storeLocationId });
    }
    await db.insert(userStoreLocation).values({ userId: fx.chef, storeLocationId: fx.a1 });
    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({ organisationId: fx.orgA, ingredientName: `${fx.tag}-flour`, ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg" })
      .returning({ id: ingredient.ingredientId });
    // A dish the chef owns, but which belongs to a location they are not assigned to.
    [{ id: fx.menuItemAtA2 }] = await db
      .insert(menuItem)
      .values({ userId: fx.chef, storeLocationId: fx.a2, name: `${fx.tag}-dish`, category: "mains", sellingPrice: "10", servings: 1 })
      .returning({ id: menuItem.menuItemId });
    for (const locId of [fx.a1, fx.a2]) {
      await db.insert(locationIngredient).values({ ingredientId: fx.ingId, storeLocationId: locId, activeInd: true, weightedAverageCost: "2" });
      await db.insert(stockLevel).values({ storeLocationId: locId, ingredientId: fx.ingId, currentQty: "10" });
    }
  });

  afterAll(async () => {
    await db.delete(sale).where(eq(sale.menuItemId, fx.menuItemAtA2));
    await db.delete(menuItem).where(eq(menuItem.menuItemId, fx.menuItemAtA2));
    await db.delete(consumptionLog).where(eq(consumptionLog.ingredientId, fx.ingId));
    await db.delete(stockLevel).where(eq(stockLevel.ingredientId, fx.ingId));
    await db.delete(locationIngredient).where(eq(locationIngredient.ingredientId, fx.ingId));
    await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    await db.delete(userStoreLocation).where(eq(userStoreLocation.userId, fx.chef));
    await db.delete(storeLocation).where(inArray(storeLocation.storeLocationId, [fx.a1, fx.a2, fx.b1]));
    for (const orgId of [fx.orgA, fx.orgB]) {
      await db.delete(auditLog).where(eq(auditLog.organisationId, orgId));
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    }
    await db.delete(user).where(inArray(user.userId, [fx.chef, fx.admin, fx.hq, fx.outsider]));
  });

  describe("canAccessLocation", () => {
    it("lets staff use a location they are assigned to", async () => {
      expect(await canAccessLocation(principal(fx.chef), fx.a1)).toBe(true);
    });

    it("refuses a location of the same organisation the staff member is not assigned to", async () => {
      expect(await canAccessLocation(principal(fx.chef), fx.a2)).toBe(false);
    });

    it("refuses a location of another organisation", async () => {
      expect(await canAccessLocation(principal(fx.chef), fx.b1)).toBe(false);
    });

    it("lets an organisation admin use every location of the organisation, and none of another", async () => {
      expect(await canAccessLocation(principal(fx.admin), fx.a1)).toBe(true);
      expect(await canAccessLocation(principal(fx.admin), fx.a2)).toBe(true);
      expect(await canAccessLocation(principal(fx.admin), fx.b1)).toBe(false);
    });

    it("lets an inventory:hq holder oversee the organisation's locations, but not another organisation's", async () => {
      expect(await canAccessLocation(principal(fx.hq, ["inventory:hq"]), fx.a2)).toBe(true);
      expect(await canAccessLocation(principal(fx.hq, ["inventory:hq"]), fx.b1)).toBe(false);
      expect(await canAccessLocation(principal(fx.hq), fx.a2)).toBe(false);
    });

    it("answers 403 LOCATION_NOT_ALLOWED when asserted", async () => {
      await expect(assertLocationAccess(principal(fx.chef), fx.a2)).rejects.toMatchObject({ statusCode: 403, code: "LOCATION_NOT_ALLOWED" });
    });
  });

  describe("controllers that take a location from the client", () => {
    it("consumption log: refuses to list another assigned-location's log", async () => {
      const out = await call(handleListLogs, fx.chef, { query: { storeLocationId: fx.a2 } });
      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "LOCATION_NOT_ALLOWED" });
    });

    it("consumption log: refuses to write at a location the user is not assigned to", async () => {
      const out = await call(handleLogConsumption, fx.chef, {
        body: { ingredientId: fx.ingId, quantity: 1, unit: "kg", reason: "spoilage", storeLocationId: fx.a2 },
      });
      expect(out.status).toBe(403);
      const rows = await db.select().from(consumptionLog).where(eq(consumptionLog.ingredientId, fx.ingId));
      expect(rows).toEqual([]);
    });

    it("consumption log: lists the user's own assigned location", async () => {
      const out = await call(handleListLogs, fx.chef, { query: { storeLocationId: fx.a1 } });
      expect(out.status).toBe(200);
    });

    it("transfers: refuses to start a transfer out of a location the user is not assigned to", async () => {
      const out = await call(handleInitiateTransfer, fx.chef, {
        body: { fromLocationId: fx.a2, toLocationId: fx.a1, lines: [{ ingredientId: fx.ingId, sentQty: 1, sentUnit: "kg" }] },
      });
      expect(out.status).toBe(403);
    });

    it("transfers: refuses to list the transfers of a location the user is not assigned to", async () => {
      const out = await call(handleListTransfers, fx.chef, { query: { storeLocationId: fx.a2 } });
      expect(out.status).toBe(403);
    });

    it("receiving: refuses to start a session at a location the user is not assigned to", async () => {
      const out = await call(handleStartSession, fx.chef, {
        body: { poId: "00000000-0000-4000-8000-000000000000", storeLocationId: fx.a2 },
      });
      expect(out.status).toBe(403);
    });
  });

  describe("sales", () => {
    it("refuses a sale whose location is the menu item's own, when the chef is not assigned there", async () => {
      await expect(
        recordSale(fx.orgA, fx.chef, { menuItemId: fx.menuItemAtA2, qtySold: 1, actor: principal(fx.chef) }),
      ).rejects.toMatchObject({ statusCode: 403, code: "LOCATION_NOT_ALLOWED" });
    });

    it("refuses an explicit location the chef is not assigned to", async () => {
      await expect(
        recordSale(fx.orgA, fx.chef, { menuItemId: fx.menuItemAtA2, qtySold: 1, locationId: fx.a2, actor: principal(fx.chef) }),
      ).rejects.toMatchObject({ code: "LOCATION_NOT_ALLOWED" });
    });

    it("fails a CSV row for the same reason and records nothing", async () => {
      const res = await commitSalesCsv(fx.orgA, fx.chef, [{ rowIndex: 1, name: `${fx.tag}-dish`, qtySold: 1 }], principal(fx.chef));
      expect(res.succeeded).toEqual([]);
      expect(res.failed).toEqual([{ rowIndex: 1, reason: "You do not have access to this location" }]);
    });
  });
});
