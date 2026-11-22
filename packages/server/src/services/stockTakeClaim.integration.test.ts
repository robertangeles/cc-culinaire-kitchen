import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

// Same .env bootstrap as the other real-DB suites (see stockTakeVariance.integration.test.ts).
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  organisation,
  user,
  userOrganisation,
  storeLocation,
  ingredient,
  locationIngredient,
  stockLevel,
  stockTakeSession,
  stockTakeCategory,
  stockTakeLine,
} from "../db/schema.js";
import { openSession, claimCategory, getSessionDetail } from "./stockTakeService.js";
import { handleSaveLineItem, handleSubmitCategory } from "../controllers/stockTakeController.js";

/**
 * Mobile release 1, PR 1 (E2): only the claimant, or a manager, may count into or submit a
 * claimed category (eng D5), and a queued command carrying an old claim revision is rejected
 * (eng D10). Drives the real controllers against the real DB. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `scl_${Date.now().toString(36)}`,
  claimantId: 0,
  otherId: 0,
  orgId: 0,
  locId: "",
  ingId: "",
  sessionId: "",
  categoryId: "",
};

type Who = { sub: number; roles: string[]; permissions: string[] };
const chef = (sub: number): Who => ({ sub, roles: [], permissions: ["inventory:count"] });

function call(
  handler: (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>,
  who: Who,
  body: object,
) {
  return new Promise<{ status: number; body: unknown }>((resolveCall, reject) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(b: unknown) {
        resolveCall({ status, body: b });
        return this;
      },
    } as unknown as Response;
    const req = { user: who, params: { id: fx.sessionId, cat: "dry_goods" }, body } as unknown as Request;
    handler(req, res, (e) => reject(e)).catch(reject);
  });
}

const save = (who: Who, extra: object = {}) =>
  call(handleSaveLineItem, who, { ingredientId: fx.ingId, rawQty: 3, countedUnit: "kg", ...extra });

async function revision() {
  const [row] = await db
    .select({ r: stockTakeCategory.claimRevision })
    .from(stockTakeCategory)
    .where(eq(stockTakeCategory.categoryId, fx.categoryId));
  return row.r;
}

describe.skipIf(!RUN)("stock take claim rules: claimant only, manager override, claim revision (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.claimantId }] = await db
      .insert(user)
      .values({ userName: "SCL claimant", userEmail: `${fx.tag}-a@it.test` })
      .returning({ userId: user.userId });
    [{ userId: fx.otherId }] = await db
      .insert(user)
      .values({ userName: "SCL other", userEmail: `${fx.tag}-b@it.test` })
      .returning({ userId: user.userId });

    [{ id: fx.orgId }] = await db
      .insert(organisation)
      .values({ organisationName: `${fx.tag}-org`, joinKey: `${fx.tag}-k`.slice(0, 25), createdBy: fx.claimantId })
      .returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values([
      { userId: fx.claimantId, organisationId: fx.orgId, role: "admin" },
      { userId: fx.otherId, organisationId: fx.orgId, role: "admin" },
    ]);

    [{ id: fx.locId }] = await db
      .insert(storeLocation)
      .values({
        organisationId: fx.orgId,
        locationName: `${fx.tag}-loc`,
        classification: "branch",
        storeKey: `${fx.tag}-s`.slice(0, 25),
        createdBy: fx.claimantId,
        inventoryActive: true,
      })
      .returning({ id: storeLocation.storeLocationId });

    [{ id: fx.ingId }] = await db
      .insert(ingredient)
      .values({
        organisationId: fx.orgId,
        ingredientName: `${fx.tag}-rice`,
        ingredientCategory: "dry_goods",
        itemType: "KITCHEN_INGREDIENT",
        baseUnit: "kg",
      })
      .returning({ id: ingredient.ingredientId });
    await db.insert(locationIngredient).values({ ingredientId: fx.ingId, storeLocationId: fx.locId, activeInd: true });
    await db.insert(stockLevel).values({ storeLocationId: fx.locId, ingredientId: fx.ingId, currentQty: "10" });

    const session = await openSession(fx.locId, fx.orgId, fx.claimantId, ["dry_goods"]);
    fx.sessionId = session.sessionId;
    const detail = await getSessionDetail(fx.sessionId, fx.orgId);
    fx.categoryId = detail!.categories.find((c) => c.categoryName === "dry_goods")!.categoryId;
    await claimCategory(fx.sessionId, "dry_goods", fx.claimantId);
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
    if (fx.ingId) await db.delete(ingredient).where(eq(ingredient.ingredientId, fx.ingId));
    if (fx.locId) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, fx.locId));
    if (fx.orgId) {
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, fx.orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, fx.orgId));
    }
    if (fx.claimantId || fx.otherId) {
      await db.delete(user).where(inArray(user.userId, [fx.claimantId, fx.otherId].filter(Boolean)));
    }
  });

  it("a claim starts at revision 1 (the column defaults to 0 and the claim bumps it)", async () => {
    expect(await revision()).toBe(1);
  });

  it("the claimant saves a line, with or without a revision (the web sends none)", async () => {
    expect((await save(chef(fx.claimantId))).status).toBe(200);
    expect((await save(chef(fx.claimantId), { claimRevision: 1 })).status).toBe(200);
  });

  it("another counter is rejected with 403 and nothing is written for them", async () => {
    const out = await save(chef(fx.otherId), { rawQty: 99 });
    expect(out.status).toBe(403);
    expect((out.body as { error: string }).error).toMatch(/claimed/);
    expect(out.body).toMatchObject({ code: "STOCK_TAKE_CLAIMED_BY_OTHER" });
    const [line] = await db.select().from(stockTakeLine).where(eq(stockTakeLine.categoryId, fx.categoryId));
    expect(Number(line.countedQty)).toBe(3);
  });

  it("a manager (inventory:manage) and an Administrator may count into another person's claim", async () => {
    const manager: Who = { sub: fx.otherId, roles: [], permissions: ["inventory:manage"] };
    const admin: Who = { sub: fx.otherId, roles: ["Administrator"], permissions: [] };
    expect((await save(manager)).status).toBe(200);
    expect((await save(admin)).status).toBe(200);
  });

  it("a stale claim revision is rejected with 403, the current one is accepted", async () => {
    const stale = await save(chef(fx.claimantId), { claimRevision: 0 });
    expect(stale.status).toBe(403);
    expect((stale.body as { error: string }).error).toMatch(/earlier claim/);
    expect(stale.body).toMatchObject({ code: "STOCK_TAKE_CLAIM_CHANGED" });
    expect((await save(chef(fx.claimantId), { claimRevision: await revision() })).status).toBe(200);
  });

  it("a recount re-claim by the same chef bumps the revision, so the first round's queued counts are rejected", async () => {
    const first = await revision();
    // HQ flags the category for a recount; the same chef claims it again.
    await db
      .update(stockTakeCategory)
      .set({ categoryStatus: "FLAGGED" })
      .where(eq(stockTakeCategory.categoryId, fx.categoryId));
    await db.update(stockTakeSession).set({ sessionStatus: "FLAGGED" }).where(eq(stockTakeSession.sessionId, fx.sessionId));
    await claimCategory(fx.sessionId, "dry_goods", fx.claimantId);

    expect(await revision()).toBe(first + 1);
    expect((await save(chef(fx.claimantId), { claimRevision: first })).status).toBe(403);
    expect((await save(chef(fx.claimantId), { claimRevision: first + 1 })).status).toBe(200);
  });

  it("claiming again while already the claimant is idempotent and does not bump the revision", async () => {
    const before = await revision();
    await claimCategory(fx.sessionId, "dry_goods", fx.claimantId);
    expect(await revision()).toBe(before);
  });

  it("submit: another counter and a stale revision are rejected; the claimant with the current revision succeeds", async () => {
    expect((await call(handleSubmitCategory, chef(fx.otherId), {})).status).toBe(403);
    expect((await call(handleSubmitCategory, chef(fx.claimantId), { claimRevision: 0 })).status).toBe(403);
    expect((await call(handleSubmitCategory, chef(fx.claimantId), { claimRevision: await revision() })).status).toBe(200);
  });

  it("submit rejects a malformed claimRevision with 400", async () => {
    expect((await call(handleSubmitCategory, chef(fx.claimantId), { claimRevision: "x" })).status).toBe(400);
  });
});
