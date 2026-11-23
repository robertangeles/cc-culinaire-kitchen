import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { and, eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  userStoreLocation,
  storeLocation,
  ingredient,
  locationIngredient,
  stockLevel,
  consumptionLog,
  menuItem,
  sale,
} from "../db/schema.js";
import {
  handleCreateMenuItem,
  handleListMenuItems,
  handleUpdateMenuItem,
  handleDeleteMenuItem,
  handleAddIngredient,
  handleListIngredients,
  handleGetAnalysis,
  handleRecalculate,
  handleRecordSale,
  handleRecordConsumableSale,
  handleVoidSale,
  handleListSales,
} from "../controllers/menuIntelligenceController.js";
import { previewSalesCsv } from "./saleService.js";
import { errorHandler } from "../middleware/errorHandler.js";
import type { TokenPayload } from "./authService.js";

/**
 * Wave 7 menu server work, real DB: menu items belong to the organisation (every member reads, the creator or an
 * organisation admin edits), reading the analysis writes nothing, and a sale is atomic, idempotent by key (body or
 * header), conflicts on a different payload, respects the stock zone and stays inside the caller's locations.
 *
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `w7m_${Date.now().toString(36)}`,
  chef: 0, // creator, member of org A, assigned to a1
  cook: 0, // colleague, member of org A, assigned to a1
  admin: 0, // org admin of A (sees every location of A)
  loner: 0, // org A member assigned to no location
  outsider: 0, // org B admin
  orgA: 0,
  orgB: 0,
  a1: "",
  a2: "",
  b1: "",
  flourId: "",
  cokeId: "",
  flourB: "",
  itemId: "", // chef's dish in A: 100 g flour per serving
  itemBId: "", // org B's dish
};

const principal = (sub: number): TokenPayload => ({ sub, roles: [], permissions: ["menu:read", "menu:manage"] });

type Handler = (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>;

/** Runs a controller the way Express does, errors through the real errorHandler. */
function call(handler: Handler, sub: number, req: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: any }>((resolveCall, reject) => {
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
    const headers = req.headers ?? {};
    const full = {
      user: principal(sub),
      body: {},
      query: {},
      params: {},
      ...req,
      header: (name: string) => headers[name],
    };
    handler(full as unknown as Request, res, next).catch(reject);
  });
}

const stockOf = async (loc: string, ingredientId: string, zone: "BOH" | "FOH") => {
  const [row] = await db
    .select({ q: stockLevel.currentQty })
    .from(stockLevel)
    .where(and(eq(stockLevel.storeLocationId, loc), eq(stockLevel.ingredientId, ingredientId), eq(stockLevel.zone, zone)));
  return row ? Number(row.q) : null;
};

describe.skipIf(!RUN)("Wave 7 menu server work (real DB)", () => {
  beforeAll(async () => {
    const mkUser = async (n: string) => {
      const [{ id }] = await db.insert(user).values({ userName: `W7 ${n}`, userEmail: `${fx.tag}-${n}@it.test` }).returning({ id: user.userId });
      return id;
    };
    fx.chef = await mkUser("chef");
    fx.cook = await mkUser("cook");
    fx.admin = await mkUser("admin");
    fx.loner = await mkUser("loner");
    fx.outsider = await mkUser("outsider");
    for (const key of ["orgA", "orgB"] as const) {
      [{ id: fx[key] }] = await db
        .insert(organisation)
        .values({ organisationName: `${fx.tag}-${key}`, joinKey: `${fx.tag}-${key}`.slice(0, 25), createdBy: fx.admin })
        .returning({ id: organisation.organisationId });
    }
    await db.insert(userOrganisation).values([
      { userId: fx.chef, organisationId: fx.orgA, role: "member" },
      { userId: fx.cook, organisationId: fx.orgA, role: "member" },
      { userId: fx.admin, organisationId: fx.orgA, role: "admin" },
      { userId: fx.loner, organisationId: fx.orgA, role: "member" },
      { userId: fx.outsider, organisationId: fx.orgB, role: "admin" },
    ]);
    for (const [key, orgId] of [["a1", fx.orgA], ["a2", fx.orgA], ["b1", fx.orgB]] as const) {
      [{ id: fx[key] }] = await db
        .insert(storeLocation)
        .values({ organisationId: orgId, locationName: `${fx.tag}-${key}`, classification: "branch", storeKey: `${fx.tag}-${key}`.slice(0, 25), createdBy: fx.admin })
        .returning({ id: storeLocation.storeLocationId });
    }
    await db.insert(userStoreLocation).values([
      { userId: fx.chef, storeLocationId: fx.a1 },
      { userId: fx.cook, storeLocationId: fx.a1 },
    ]);

    const mkIng = async (orgId: number, loc: string, name: string, itemType: string, base: string) => {
      const [row] = await db
        .insert(ingredient)
        .values({ organisationId: orgId, ingredientName: `${fx.tag}-${name}`, ingredientCategory: "other", itemType, baseUnit: base, preferredUnitCost: "0.0100" })
        .returning({ id: ingredient.ingredientId });
      await db.insert(locationIngredient).values({ ingredientId: row.id, storeLocationId: loc, weightedAverageCost: "0.0100", activeInd: true });
      return row.id;
    };
    fx.flourId = await mkIng(fx.orgA, fx.a1, "flour", "KITCHEN_INGREDIENT", "g");
    fx.cokeId = await mkIng(fx.orgA, fx.a1, "coke", "FOH_CONSUMABLE", "each");
    fx.flourB = await mkIng(fx.orgB, fx.b1, "flourB", "KITCHEN_INGREDIENT", "g");
    // Kitchen stock lives in BOH, the shelf in FOH. The coke also has 99 in BOH: a sale must not touch it.
    await db.insert(stockLevel).values([
      { storeLocationId: fx.a1, ingredientId: fx.flourId, zone: "BOH", currentQty: "5000" },
      { storeLocationId: fx.a1, ingredientId: fx.flourId, zone: "FOH", currentQty: "7" },
      { storeLocationId: fx.a1, ingredientId: fx.cokeId, zone: "BOH", currentQty: "99" },
      { storeLocationId: fx.a1, ingredientId: fx.cokeId, zone: "FOH", currentQty: "10" },
      { storeLocationId: fx.b1, ingredientId: fx.flourB, zone: "BOH", currentQty: "100" },
    ]);

    const created = await call(handleCreateMenuItem, fx.chef, { body: { name: `${fx.tag} dish`, category: "mains", sellingPrice: "12.00", servings: 1 } });
    fx.itemId = created.body.menuItemId;
    await call(handleAddIngredient, fx.chef, {
      params: { id: fx.itemId },
      body: { ingredientId: fx.flourId, ingredientName: "flour", quantity: "100", unit: "g" },
    });
    const createdB = await call(handleCreateMenuItem, fx.outsider, { body: { name: `${fx.tag} dish B`, category: "mains", sellingPrice: "9.00" } });
    fx.itemBId = createdB.body.menuItemId;
  });

  afterAll(async () => {
    const orgs = [fx.orgA, fx.orgB];
    const users = [fx.chef, fx.cook, fx.admin, fx.loner, fx.outsider];
    const ingIds = [fx.flourId, fx.cokeId, fx.flourB];
    await db.delete(consumptionLog).where(inArray(consumptionLog.organisationId, orgs));
    await db.delete(sale).where(inArray(sale.organisationId, orgs));
    await db.delete(menuItem).where(inArray(menuItem.userId, users)); // cascades recipe lines
    await db.delete(stockLevel).where(inArray(stockLevel.ingredientId, ingIds));
    await db.delete(locationIngredient).where(inArray(locationIngredient.ingredientId, ingIds));
    await db.delete(ingredient).where(inArray(ingredient.ingredientId, ingIds));
    await db.delete(userStoreLocation).where(inArray(userStoreLocation.userId, users));
    await db.delete(storeLocation).where(inArray(storeLocation.organisationId, orgs));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, orgs));
    await db.delete(organisation).where(inArray(organisation.organisationId, orgs));
    await db.delete(user).where(inArray(user.userId, users));
  });

  describe("menu items belong to the organisation", () => {
    it("stamps the creator's organisation on a new item", async () => {
      const [row] = await db.select({ org: menuItem.organisationId }).from(menuItem).where(eq(menuItem.menuItemId, fx.itemId));
      expect(row.org).toBe(fx.orgA);
    });

    it("every member of the organisation lists it, the other organisation does not", async () => {
      for (const who of [fx.chef, fx.cook, fx.admin, fx.loner]) {
        const { status, body } = await call(handleListMenuItems, who);
        expect(status).toBe(200);
        expect(body.map((i: { menuItemId: string }) => i.menuItemId)).toContain(fx.itemId);
        expect(body.map((i: { menuItemId: string }) => i.menuItemId)).not.toContain(fx.itemBId);
      }
      const other = await call(handleListMenuItems, fx.outsider);
      expect(other.body.map((i: { menuItemId: string }) => i.menuItemId)).toEqual([fx.itemBId]);
    });

    it("a colleague cannot edit or delete: 403 FORBIDDEN, and nothing changes", async () => {
      const patch = await call(handleUpdateMenuItem, fx.cook, { params: { id: fx.itemId }, body: { name: "hijacked" } });
      expect(patch.status).toBe(403);
      expect(patch.body.code).toBe("FORBIDDEN");
      const del = await call(handleDeleteMenuItem, fx.cook, { params: { id: fx.itemId } });
      expect(del.status).toBe(403);
      expect(del.body.code).toBe("FORBIDDEN");
      const add = await call(handleAddIngredient, fx.cook, { params: { id: fx.itemId }, body: { ingredientName: "x", quantity: "1", unit: "g" } });
      expect(add.status).toBe(403);
      const [row] = await db.select({ name: menuItem.name }).from(menuItem).where(eq(menuItem.menuItemId, fx.itemId));
      expect(row.name).toBe(`${fx.tag} dish`);
    });

    it("another organisation's item is not found (404 NOT_FOUND), even for its admin", async () => {
      const patch = await call(handleUpdateMenuItem, fx.outsider, { params: { id: fx.itemId }, body: { name: "x" } });
      expect(patch.status).toBe(404);
      expect(patch.body.code).toBe("NOT_FOUND");
      const del = await call(handleDeleteMenuItem, fx.outsider, { params: { id: fx.itemId } });
      expect(del.status).toBe(404);
    });

    it("the creator and an organisation admin may edit; the admin of another organisation may not", async () => {
      const byCreator = await call(handleUpdateMenuItem, fx.chef, { params: { id: fx.itemId }, body: { sellingPrice: "13.00" } });
      expect(byCreator.status).toBe(200);
      expect(byCreator.body.sellingPrice).toBe("13.00");
      const byAdmin = await call(handleUpdateMenuItem, fx.admin, { params: { id: fx.itemId }, body: { sellingPrice: "12.00" } });
      expect(byAdmin.status).toBe(200);
      expect(byAdmin.body.sellingPrice).toBe("12.00");
    });

    it("a row an older server wrote without an organisation stays visible to its creator only", async () => {
      const [legacy] = await db
        .insert(menuItem)
        .values({ userId: fx.chef, name: `${fx.tag} legacy`, category: "mains", sellingPrice: "5.00" })
        .returning({ id: menuItem.menuItemId });
      const mine = await call(handleListMenuItems, fx.chef);
      expect(mine.body.map((i: { menuItemId: string }) => i.menuItemId)).toContain(legacy.id);
      const theirs = await call(handleListMenuItems, fx.cook);
      expect(theirs.body.map((i: { menuItemId: string }) => i.menuItemId)).not.toContain(legacy.id);
    });
  });

  describe("GET /analysis writes nothing", () => {
    it("leaves stored classification and mix untouched, with or without ?category=", async () => {
      await db.update(menuItem).set({ unitsSold: 5, classification: "unclassified", menuMixPct: null }).where(eq(menuItem.menuItemId, fx.itemId));
      const before = await db.select().from(menuItem).where(inArray(menuItem.userId, [fx.chef, fx.outsider]));

      const all = await call(handleGetAnalysis, fx.cook);
      const byCategory = await call(handleGetAnalysis, fx.cook, { query: { category: "mains" } });
      expect(all.status).toBe(200);
      expect(byCategory.status).toBe(200);

      const after = await db.select().from(menuItem).where(inArray(menuItem.userId, [fx.chef, fx.outsider]));
      expect(after).toEqual(before);
    });

    it("still answers the computed classification and mix, org-wide, and never another organisation's items", async () => {
      const { body } = await call(handleGetAnalysis, fx.cook);
      const mine = body.items.find((i: { menuItemId: string }) => i.menuItemId === fx.itemId);
      expect(mine).toBeDefined();
      expect(mine.menuMixPct).toBeGreaterThan(0);
      expect(mine.classification).not.toBe("unclassified");
      expect(body.items.map((i: { menuItemId: string }) => i.menuItemId)).not.toContain(fx.itemBId);
    });

    it("POST /analysis/recalculate is what persists them", async () => {
      const done = await call(handleRecalculate, fx.chef, { body: {} });
      expect(done.status).toBe(200);
      const [row] = await db.select({ c: menuItem.classification, m: menuItem.menuMixPct }).from(menuItem).where(eq(menuItem.menuItemId, fx.itemId));
      expect(row.c).not.toBe("unclassified");
      expect(Number(row.m)).toBeGreaterThan(0);
    });
  });

  describe("recording a sale", () => {
    const sell = (who: number, qty: number, extra: { key?: string; headerKey?: string; locationId?: string; itemId?: string } = {}) =>
      call(handleRecordSale, who, {
        params: { id: extra.itemId ?? fx.itemId },
        body: { qtySold: qty, locationId: extra.locationId ?? fx.a1, ...(extra.key ? { idempotencyKey: extra.key } : {}) },
        headers: extra.headerKey ? { "Idempotency-Key": extra.headerKey } : {},
      });
    const salesWithKey = (key: string) => db.select().from(sale).where(and(eq(sale.organisationId, fx.orgA), eq(sale.idempotencyKey, key)));

    it("a colleague sells the chef's item; the other organisation cannot", async () => {
      const ok = await sell(fx.cook, 1);
      expect(ok.status).toBe(201);
      const [row] = await db.select({ by: sale.createdBy, org: sale.organisationId }).from(sale).where(eq(sale.saleId, ok.body.saleId));
      expect(row).toEqual({ by: fx.cook, org: fx.orgA });
      const other = await sell(fx.outsider, 1, { locationId: fx.b1 });
      expect(other.status).toBe(404);
      expect(other.body.code).toBe("NOT_FOUND");
    });

    it("only at a location the caller belongs to: 403 LOCATION_NOT_ALLOWED for an unassigned member and for another organisation's location", async () => {
      const notAssigned = await sell(fx.cook, 1, { locationId: fx.a2 });
      expect(notAssigned.status).toBe(403);
      expect(notAssigned.body.code).toBe("LOCATION_NOT_ALLOWED");
      const lonerAtA1 = await sell(fx.loner, 1, { locationId: fx.a1 });
      expect(lonerAtA1.status).toBe(403);
      const foreign = await sell(fx.cook, 1, { locationId: fx.b1 });
      expect(foreign.status).toBe(403);
      expect(foreign.body.code).toBe("LOCATION_NOT_ALLOWED");
    });

    it("an org admin may sell at any location of the organisation", async () => {
      const res = await sell(fx.admin, 1, { locationId: fx.a2 });
      expect(res.status).toBe(201);
    });

    it("the key may come in the body or in the header, and a replay records and deducts once", async () => {
      const before = (await stockOf(fx.a1, fx.flourId, "BOH"))!;
      const first = await sell(fx.cook, 2, { key: `${fx.tag}-body` });
      const replay = await sell(fx.cook, 2, { key: `${fx.tag}-body` });
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.saleId).toBe(first.body.saleId);
      expect(replay.body.alreadyExists).toBe(true);
      expect(await salesWithKey(`${fx.tag}-body`)).toHaveLength(1);
      expect(await stockOf(fx.a1, fx.flourId, "BOH")).toBe(before - 200);

      const h1 = await sell(fx.cook, 1, { headerKey: `${fx.tag}-hdr` });
      const h2 = await sell(fx.cook, 1, { headerKey: `${fx.tag}-hdr` });
      expect(h2.body.saleId).toBe(h1.body.saleId);
      expect(await salesWithKey(`${fx.tag}-hdr`)).toHaveLength(1);

      // The same key in header and body are one key.
      const mixed = await sell(fx.cook, 1, { key: `${fx.tag}-hdr` });
      expect(mixed.body.saleId).toBe(h1.body.saleId);
    });

    it("the same key with a different payload is a coded 409 and records nothing", async () => {
      const first = await sell(fx.cook, 2, { key: `${fx.tag}-conflict` });
      expect(first.status).toBe(201);
      const before = (await stockOf(fx.a1, fx.flourId, "BOH"))!;
      const otherQty = await sell(fx.cook, 3, { key: `${fx.tag}-conflict` });
      expect(otherQty.status).toBe(409);
      expect(otherQty.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      const [otherItem] = await db
        .insert(menuItem)
        .values({ userId: fx.chef, organisationId: fx.orgA, name: `${fx.tag} other`, category: "mains", sellingPrice: "4.00" })
        .returning({ id: menuItem.menuItemId });
      const otherDish = await sell(fx.cook, 2, { key: `${fx.tag}-conflict`, itemId: otherItem.id });
      expect(otherDish.status).toBe(409);
      expect(otherDish.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await salesWithKey(`${fx.tag}-conflict`)).toHaveLength(1);
      expect(await stockOf(fx.a1, fx.flourId, "BOH")).toBe(before);
    });

    it("a concurrent pair with one key records one sale and neither request fails", async () => {
      const before = (await stockOf(fx.a1, fx.flourId, "BOH"))!;
      const pair = await Promise.all([sell(fx.cook, 1, { key: `${fx.tag}-race` }), sell(fx.chef, 1, { key: `${fx.tag}-race` })]);
      expect(pair.map((p) => p.status)).toEqual([201, 201]);
      expect(pair[0].body.saleId).toBe(pair[1].body.saleId);
      expect(pair.filter((p) => p.body.alreadyExists).length).toBe(1);
      expect(await salesWithKey(`${fx.tag}-race`)).toHaveLength(1);
      expect(await stockOf(fx.a1, fx.flourId, "BOH")).toBe(before - 100);
    });

    it("the same key in another organisation is a different sale", async () => {
      await sell(fx.cook, 1, { key: `${fx.tag}-shared` });
      const other = await sell(fx.outsider, 1, { key: `${fx.tag}-shared`, locationId: fx.b1, itemId: fx.itemBId });
      expect(other.status).toBe(201);
      expect(other.body.alreadyExists).toBeUndefined();
    });

    it("rejects a non-positive quantity with a coded 400", async () => {
      const res = await sell(fx.cook, 0);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });
  });

  describe("stock deduction respects the zone", () => {
    it("a kitchen ingredient comes out of BOH and a FOH consumable out of FOH; void restores the same rows", async () => {
      const flourBoh = (await stockOf(fx.a1, fx.flourId, "BOH"))!;
      const flourFoh = await stockOf(fx.a1, fx.flourId, "FOH");
      const dish = await call(handleRecordSale, fx.cook, { params: { id: fx.itemId }, body: { qtySold: 1, locationId: fx.a1 } });
      expect(await stockOf(fx.a1, fx.flourId, "BOH")).toBe(flourBoh - 100);
      expect(await stockOf(fx.a1, fx.flourId, "FOH")).toBe(flourFoh);

      const cokeBoh = await stockOf(fx.a1, fx.cokeId, "BOH");
      const can = await call(handleRecordConsumableSale, fx.cook, { params: { ingredientId: fx.cokeId }, body: { qtySold: 3, locationId: fx.a1 } });
      expect(can.status).toBe(201);
      expect(await stockOf(fx.a1, fx.cokeId, "FOH")).toBe(7);
      expect(await stockOf(fx.a1, fx.cokeId, "BOH")).toBe(cokeBoh);
      expect(can.body.depleted[0].fohOnHand).toBe(7);

      const voidCan = await call(handleVoidSale, fx.chef, { params: { saleId: can.body.saleId } });
      // The recorder is the cook, not the chef: only the recorder or an org admin may void.
      expect(voidCan.status).toBe(403);
      const voided = await call(handleVoidSale, fx.cook, { params: { saleId: can.body.saleId } });
      expect(voided.status).toBe(200);
      expect(await stockOf(fx.a1, fx.cokeId, "FOH")).toBe(10);
      expect(await stockOf(fx.a1, fx.cokeId, "BOH")).toBe(cokeBoh);

      const voidDish = await call(handleVoidSale, fx.admin, { params: { saleId: dish.body.saleId } });
      expect(voidDish.status).toBe(200);
      expect(await stockOf(fx.a1, fx.flourId, "BOH")).toBe(flourBoh);
      expect(await stockOf(fx.a1, fx.flourId, "FOH")).toBe(flourFoh);
    });
  });

  describe("voiding a sale", () => {
    it("is for the person who recorded it or an organisation admin, at a location they can use", async () => {
      const made = await call(handleRecordSale, fx.cook, { params: { id: fx.itemId }, body: { qtySold: 1, locationId: fx.a1 } });
      const byOther = await call(handleVoidSale, fx.chef, { params: { saleId: made.body.saleId } });
      expect(byOther.status).toBe(403);
      expect(byOther.body.code).toBe("FORBIDDEN");
      const foreign = await call(handleVoidSale, fx.outsider, { params: { saleId: made.body.saleId } });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe("NOT_FOUND");
      const own = await call(handleVoidSale, fx.cook, { params: { saleId: made.body.saleId } });
      expect(own.status).toBe(200);
      const again = await call(handleVoidSale, fx.cook, { params: { saleId: made.body.saleId } });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("INVALID_STATE");
    });

    it("is refused for a recorder who has since lost the location", async () => {
      const made = await call(handleRecordSale, fx.chef, { params: { id: fx.itemId }, body: { qtySold: 1, locationId: fx.a1 } });
      await db.delete(userStoreLocation).where(and(eq(userStoreLocation.userId, fx.chef), eq(userStoreLocation.storeLocationId, fx.a1)));
      const res = await call(handleVoidSale, fx.chef, { params: { saleId: made.body.saleId } });
      await db.insert(userStoreLocation).values({ userId: fx.chef, storeLocationId: fx.a1 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("LOCATION_NOT_ALLOWED");
    });
  });

  describe("reading and deleting", () => {
    it("a colleague reads the recipe lines of the chef's item; the other organisation gets 404", async () => {
      const mine = await call(handleListIngredients, fx.cook, { params: { id: fx.itemId } });
      expect(mine.status).toBe(200);
      expect(mine.body.length).toBeGreaterThan(0);
      const theirs = await call(handleListIngredients, fx.outsider, { params: { id: fx.itemId } });
      expect(theirs.status).toBe(404);
      expect(theirs.body.code).toBe("NOT_FOUND");
    });

    it("the CSV preview matches names across the organisation, and never another organisation's", async () => {
      const preview = await previewSalesCsv(fx.orgA, fx.cook, `item,qty\n${fx.tag} dish,2\n${fx.tag} dish B,1`);
      expect(preview.matched.map((m) => m.menuItemId)).toEqual([fx.itemId]);
      expect(preview.unmatched.map((u) => u.name)).toEqual([`${fx.tag} dish B`]);
    });

    it("lists a location's sales for a member of that location", async () => {
      const ok = await call(handleListSales, fx.cook, { params: { locId: fx.a1 }, query: {} });
      expect(ok.status).toBe(200);
      expect(ok.body.length).toBeGreaterThan(0);
    });

    it("an item with recorded sales cannot be deleted: 409 CONFLICT, not a 500", async () => {
      const res = await call(handleDeleteMenuItem, fx.chef, { params: { id: fx.itemId } });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      const [row] = await db.select({ id: menuItem.menuItemId }).from(menuItem).where(eq(menuItem.menuItemId, fx.itemId));
      expect(row).toBeDefined();
    });

    it("an item without sales is deleted by its creator or an organisation admin", async () => {
      const made = await call(handleCreateMenuItem, fx.chef, { body: { name: `${fx.tag} gone`, category: "mains", sellingPrice: "3.00" } });
      const byAdmin = await call(handleDeleteMenuItem, fx.admin, { params: { id: made.body.menuItemId } });
      expect(byAdmin.status).toBe(200);
      const again = await call(handleDeleteMenuItem, fx.chef, { params: { id: made.body.menuItemId } });
      expect(again.status).toBe(404);
    });
  });
});
