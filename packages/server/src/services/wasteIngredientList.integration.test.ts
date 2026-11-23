import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingredient, organisation, user, userOrganisation } from "../db/schema.js";
import { handleListIngredientsForWaste } from "../controllers/wasteController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * GET /api/waste/ingredients: the picker list for a cook who may log waste but not count stock. Id, name and kitchen unit only,
 * the caller's organisation only, soft-deleted rows left out. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let otherOrg: number;
let otherUser: number;
let loner: number;
let otherIng: string;
let removedIng: string;

describe.skipIf(!RUN)("waste ingredient list (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`wi_${Date.now().toString(36)}`);
    [{ id: otherUser }] = await db.insert(user).values({ userName: "WI other", userEmail: `${fx.tag}-other@it.test` }).returning({ id: user.userId });
    [{ id: loner }] = await db.insert(user).values({ userName: "WI loner", userEmail: `${fx.tag}-loner@it.test` }).returning({ id: user.userId });
    [{ id: otherOrg }] = await db.insert(organisation).values({ organisationName: `${fx.tag}-other-org`, joinKey: `${fx.tag}-o`.slice(0, 25), createdBy: otherUser }).returning({ id: organisation.organisationId });
    await db.insert(userOrganisation).values({ userId: otherUser, organisationId: otherOrg, role: "admin" });
    // Rows that carry the fields the list must never show.
    [{ id: otherIng }] = await db.insert(ingredient).values({ organisationId: otherOrg, ingredientName: `${fx.tag}-other-saffron`, ingredientCategory: "spice", baseUnit: "g", unitCost: "9.99", parLevel: "5" }).returning({ id: ingredient.ingredientId });
    [{ id: removedIng }] = await db.insert(ingredient).values({ organisationId: fx.orgId, ingredientName: `${fx.tag}-removed`, ingredientCategory: "spice", baseUnit: "g", deletedAt: new Date() }).returning({ id: ingredient.ingredientId });
    await db.update(ingredient).set({ unitCost: "3.50", parLevel: "4", reorderQty: "8", description: "secret note" }).where(eq(ingredient.ingredientId, fx.ingId));
  });
  afterAll(async () => {
    await db.delete(ingredient).where(inArray(ingredient.ingredientId, [otherIng, removedIng]));
    await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, otherOrg));
    await db.delete(organisation).where(eq(organisation.organisationId, otherOrg));
    await db.delete(user).where(inArray(user.userId, [otherUser, loner]));
    await removeLineLoopFx(fx);
  });

  it("gives a waste:log-only cook the organisation's active ingredients as id, name and unit, and nothing else", async () => {
    const out = await callHandler(handleListIngredientsForWaste, asUser(fx.cook, ["waste:log"]));

    expect(out.status).toBe(200);
    expect(out.body).toEqual([
      { ingredientId: fx.ingId, ingredientName: `${fx.tag}-flour`, baseUnit: "kg" },
      { ingredientId: fx.ingNoStockId, ingredientName: `${fx.tag}-salt`, baseUnit: "kg" },
    ]);
    for (const row of out.body as unknown as object[]) expect(Object.keys(row).sort()).toEqual(["baseUnit", "ingredientId", "ingredientName"]);
    expect(JSON.stringify(out.body)).not.toMatch(/3\.50|secret note|unitCost|currentQty|supplier/);
  });

  it("never lists another organisation's ingredients, and the other organisation never sees this one's", async () => {
    const mine = await callHandler(handleListIngredientsForWaste, asUser(fx.chef, ["waste:log"]));
    const theirs = await callHandler(handleListIngredientsForWaste, asUser(otherUser, ["waste:log"]));

    expect((mine.body as unknown as Array<{ ingredientId: string }>).map((r) => r.ingredientId)).not.toContain(otherIng);
    expect(theirs.body).toEqual([{ ingredientId: otherIng, ingredientName: `${fx.tag}-other-saffron`, baseUnit: "g" }]);
  });

  it("leaves out an ingredient that was removed", async () => {
    const out = await callHandler(handleListIngredientsForWaste, asUser(fx.cook, ["waste:log"]));
    expect((out.body as unknown as Array<{ ingredientId: string }>).map((r) => r.ingredientId)).not.toContain(removedIng);
  });

  it("is the same for a location-less org admin and for a cook at a single location (ingredients belong to the organisation)", async () => {
    const boss = await callHandler(handleListIngredientsForWaste, asUser(fx.boss, [], ["Administrator"]));
    const stranger = await callHandler(handleListIngredientsForWaste, asUser(fx.stranger, ["waste:log"]));
    expect(boss.body).toEqual(stranger.body);
  });

  it("refuses someone who belongs to no organisation: 403 FORBIDDEN, no list", async () => {
    const out = await callHandler(handleListIngredientsForWaste, asUser(loner, ["waste:log"]));
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ code: "FORBIDDEN" });
  });
});
