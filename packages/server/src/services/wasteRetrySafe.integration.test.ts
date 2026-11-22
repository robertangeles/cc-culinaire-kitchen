import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { recipe, user, wasteLog } from "../db/schema.js";
import {
  handleLogWaste, handleDeleteWasteLog, handleEditWasteLog, handleGetWasteLogs, handleGetWasteSummary, handleGetIngredientSuggestions,
} from "../controllers/wasteController.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Waste log, made safe for a phone that queues offline and retries (Wave 2): client-made ids, the location
 * taken from the request and checked, date-only report bounds, the suggestions query, a delete replay.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
const body = (extra: object = {}) => ({ ingredientName: "Flour", quantity: 2, unit: "kg", reason: "spoilage", ...extra });
const rowsOf = (id: string) => db.select().from(wasteLog).where(eq(wasteLog.wasteLogId, id));

describe.skipIf(!RUN)("waste log, retry-safe (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`wl_${Date.now().toString(36)}`);
  });
  afterAll(async () => {
    await removeLineLoopFx(fx);
  });

  describe("create", () => {
    it("a repeat of the same wasteLogId stores one row and answers both sends with it", async () => {
      const wasteLogId = randomUUID();
      const first = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locA }) });
      const again = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locA }) });

      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.wasteLogId).toBe(wasteLogId);
      expect(await rowsOf(wasteLogId)).toHaveLength(1);
    });

    it("an id that another user's entry holds is 409 CONFLICT and leaves their entry alone", async () => {
      const wasteLogId = randomUUID();
      await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locA }) });
      const out = await callHandler(handleLogWaste, asUser(fx.cook, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locA }) });

      expect(out.status).toBe(409);
      expect(out.body).toMatchObject({ code: "CONFLICT" });
      expect((await rowsOf(wasteLogId))[0].userId).toBe(fx.chef);
    });

    it("lands at the location named in the request, not the one saved on the user (a queued log replayed after a switch)", async () => {
      await db.update(user).set({ selectedLocationId: fx.locB }).where(eq(user.userId, fx.roamer));
      const wasteLogId = randomUUID();
      const out = await callHandler(handleLogWaste, asUser(fx.roamer, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locA }) });

      expect(out.status).toBe(201);
      const [row] = await rowsOf(wasteLogId);
      expect(row.storeLocationId).toBe(fx.locA);
      expect(row.organisationId).toBe(fx.orgId);
    });

    it("refuses a location the caller is not assigned to: 403 LOCATION_NOT_ALLOWED, nothing stored", async () => {
      const wasteLogId = randomUUID();
      const out = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ wasteLogId, storeLocationId: fx.locB }) });

      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "LOCATION_NOT_ALLOWED" });
      expect(await rowsOf(wasteLogId)).toHaveLength(0);
    });

    it("without a location in the body it still uses the saved location (the web sends none)", async () => {
      await db.update(user).set({ selectedLocationId: fx.locA }).where(eq(user.userId, fx.chef));
      const out = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body() });

      expect(out.status).toBe(201);
      const [row] = await rowsOf(out.body.wasteLogId);
      expect(row.storeLocationId).toBe(fx.locA);
    });

    it("rejects an id that is not a UUID with 400", async () => {
      const out = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ wasteLogId: "not-a-uuid" }) });
      expect(out.status).toBe(400);
    });
  });

  describe("delete and edit", () => {
    it("a repeat of a delete answers success, not 404", async () => {
      const made = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ storeLocationId: fx.locA }) });
      const id = made.body.wasteLogId;
      const first = await callHandler(handleDeleteWasteLog, asUser(fx.chef, ["waste:log"]), { params: { id } });
      const again = await callHandler(handleDeleteWasteLog, asUser(fx.chef, ["waste:log"]), { params: { id } });

      expect(first).toMatchObject({ status: 200, body: { ok: true } });
      expect(again).toMatchObject({ status: 200, body: { ok: true } });
    });

    it("someone else's entry is not deletable: 403 FORBIDDEN, and it stays", async () => {
      const made = await callHandler(handleLogWaste, asUser(fx.chef, ["waste:log"]), { body: body({ storeLocationId: fx.locA }) });
      const out = await callHandler(handleDeleteWasteLog, asUser(fx.cook, ["waste:log"]), { params: { id: made.body.wasteLogId } });

      expect(out.status).toBe(403);
      expect(out.body).toMatchObject({ code: "FORBIDDEN" });
      expect(await rowsOf(made.body.wasteLogId)).toHaveLength(1);
    });

    it("editing an entry that is gone is 404 NOT_FOUND with a code", async () => {
      const out = await callHandler(handleEditWasteLog, asUser(fx.chef, ["waste:log"]), { params: { id: randomUUID() }, body: { quantity: 3 } });
      expect(out.status).toBe(404);
      expect(out.body).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("reports", () => {
    it("a date-only range includes its end day (summary and list)", async () => {
      await callHandler(handleLogWaste, asUser(fx.cook, ["waste:log"]), {
        body: body({ storeLocationId: fx.locA, loggedAt: "2026-03-05T15:00:00.000Z", estimatedCost: 4 }),
      });
      const range = { startDate: "2026-03-05", endDate: "2026-03-05" };
      const summary = await callHandler(handleGetWasteSummary, asUser(fx.cook, ["waste:read"]), { query: range });
      const list = await callHandler(handleGetWasteLogs, asUser(fx.cook, ["waste:read"]), { query: range });

      expect(summary.body.totalEntries).toBe(1);
      expect(list.body.total).toBe(1);
    });

    it("a datetime end still means that exact moment", async () => {
      const summary = await callHandler(handleGetWasteSummary, asUser(fx.cook, ["waste:read"]), {
        query: { startDate: "2026-03-05T00:00:00.000Z", endDate: "2026-03-05T12:00:00.000Z" },
      });
      expect(summary.body.totalEntries).toBe(0);
    });

    it("the team view needs waste:read: a logger with only waste:log is refused it, and sees their own list", async () => {
      const team = await callHandler(handleGetWasteLogs, asUser(fx.cook, ["waste:log"]), { query: { teamView: "true" } });
      const own = await callHandler(handleGetWasteLogs, asUser(fx.cook, ["waste:log"]), {});

      expect(team.status).toBe(403);
      expect(team.body).toMatchObject({ code: "FORBIDDEN" });
      expect(own.status).toBe(200);
    });
  });

  describe("suggestions", () => {
    it("finds ingredient names in the caller's recipes (the jsonb query used to be a Postgres error)", async () => {
      await db.insert(recipe).values({
        userId: fx.chef,
        title: `${fx.tag}-recipe`,
        recipeData: { ingredients: [{ name: `${fx.tag} Zucchini` }, { name: "Something else" }] },
      });
      const out = await callHandler(handleGetIngredientSuggestions, asUser(fx.chef, ["waste:log"]), { query: { q: "zucchini" } });

      expect(out.status).toBe(200);
      expect(out.body.ingredients).toContain(`${fx.tag} Zucchini`);
    });
  });
});
