import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

// Passes through to the real stock functions; one test makes the deduction fail.
vi.mock("./stockService.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stockService.js")>();
  return { ...real, deductStock: vi.fn(real.deductStock) };
});

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { consumptionLog, menuItem, menuItemIngredient, prepSession, prepTask, stockLevel, user } from "../db/schema.js";
import {
  handleCreateSession, handleEndSession, handleGenerateFromSelections, handleGetSession, handleGetTodaySession, handleSaveSelections, handleUpdateTask,
} from "../controllers/prepController.js";
import { deductStock } from "./stockService.js";
import { asUser, callHandler, createLineLoopFx, removeLineLoopFx, type LineLoopFx } from "./lineLoopFixture.js";

/**
 * Prep for a kitchen with more than one cook and a phone that retries (Wave 2): any member at the location
 * ticks and the server records who; an ended session, a lost race and a stranger each answer with their own
 * code; a replayed generate does not rebuild; "today" is a date at a location; stock moves atomically with the tick.
 * Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

let fx: LineLoopFx;
let chef: ReturnType<typeof asUser>;
let cook: ReturnType<typeof asUser>;
let stranger: ReturnType<typeof asUser>;
let boss: ReturnType<typeof asUser>;
const today = "2026-04-10";

const stockOf = async () => Number((await db.select().from(stockLevel).where(eq(stockLevel.ingredientId, fx.ingId)))[0].currentQty);
const taskRow = async (id: string) => (await db.select().from(prepTask).where(eq(prepTask.prepTaskId, id)))[0];

async function newSession(owner: typeof chef = chef, extra: object = {}) {
  const out = await callHandler(handleCreateSession, owner, { body: { prepDate: today, storeLocationId: fx.locA, ...extra } });
  expect(out.status).toBe(201);
  return out.body.session.prepSessionId as string;
}

async function newTask(sessionId: string, opts: { ingredientId?: string | null; qty?: number } = {}) {
  const ingredientId = opts.ingredientId === undefined ? fx.ingId : opts.ingredientId;
  const [t] = await db
    .insert(prepTask)
    .values({
      prepSessionId: sessionId,
      userId: fx.chef,
      taskDescription: "Prep flour",
      ingredientName: "Flour",
      quantityNeeded: String(opts.qty ?? 2),
      unit: "kg",
      priorityScore: "1",
      priorityTier: "start_first",
      ingredientId,
    })
    .returning({ id: prepTask.prepTaskId });
  return t.id;
}

const tick = (who: typeof chef, id: string, body: object) => callHandler(handleUpdateTask, who, { params: { id }, body });

describe.skipIf(!RUN)("prep line loop (real DB)", () => {
  beforeAll(async () => {
    fx = await createLineLoopFx(`pl_${Date.now().toString(36)}`);
    chef = asUser(fx.chef, ["prep:manage", "prep:read"]);
    cook = asUser(fx.cook, ["prep:read"]);
    stranger = asUser(fx.stranger, ["prep:read", "prep:manage"]);
    boss = asUser(fx.boss, [], ["Administrator"]);
  });
  afterAll(async () => {
    await removeLineLoopFx(fx);
  });

  describe("creating a session", () => {
    it("a repeat of the same prepSessionId stores one session and answers both sends with it", async () => {
      const prepSessionId = randomUUID();
      const first = await callHandler(handleCreateSession, chef, { body: { prepSessionId, prepDate: today, storeLocationId: fx.locA } });
      const again = await callHandler(handleCreateSession, chef, { body: { prepSessionId, prepDate: today, storeLocationId: fx.locA } });

      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.session.prepSessionId).toBe(prepSessionId);
      expect(await db.select().from(prepSession).where(eq(prepSession.prepSessionId, prepSessionId))).toHaveLength(1);
    });

    it("an id another user's session holds is 409 CONFLICT", async () => {
      const prepSessionId = randomUUID();
      await callHandler(handleCreateSession, chef, { body: { prepSessionId, prepDate: today, storeLocationId: fx.locA } });
      const out = await callHandler(handleCreateSession, cook, { body: { prepSessionId, prepDate: today, storeLocationId: fx.locA } });
      expect(out).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    });

    it("is created at the location of the request, and refused at a location the caller does not work at", async () => {
      await db.update(user).set({ selectedLocationId: fx.locB }).where(eq(user.userId, fx.roamer));
      const ok = await callHandler(handleCreateSession, asUser(fx.roamer, ["prep:manage"]), { body: { prepDate: today, storeLocationId: fx.locA } });
      const [row] = await db.select().from(prepSession).where(eq(prepSession.prepSessionId, ok.body.session.prepSessionId));
      expect(row.storeLocationId).toBe(fx.locA);
      expect(row.organisationId).toBe(fx.orgId);

      const refused = await callHandler(handleCreateSession, chef, { body: { prepDate: today, storeLocationId: fx.locB } });
      expect(refused).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
    });

    it("rejects a prepDate that is not a date with 400, not a database error", async () => {
      const out = await callHandler(handleCreateSession, chef, { body: { prepDate: "tomorrow" } });
      expect(out.status).toBe(400);
    });
  });

  describe("ticking a task", () => {
    it("any member at the location can tick, and the server records who", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      const out = await tick(cook, taskId, { status: "completed" });

      expect(out.status).toBe(200);
      expect(out.body.status).toBe("completed");
      expect(out.body.completedBy).toBe(fx.cook);
      expect((await taskRow(taskId)).completedBy).toBe(fx.cook);
    });

    it("a member of another location of the organisation is refused: 403 FORBIDDEN, task unchanged", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      const out = await tick(asUser(fx.stranger, ["prep:read"]), taskId, { status: "completed" });

      expect(out).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
      expect((await taskRow(taskId)).status).toBe("pending");
    });

    it("an unknown task is 404 NOT_FOUND", async () => {
      expect(await tick(cook, randomUUID(), { status: "completed" })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    });

    it("a task of an ended session is 409 PREP_SESSION_ENDED", async () => {
      const sessionId = await newSession();
      const taskId = await newTask(sessionId, { ingredientId: null });
      await callHandler(handleEndSession, chef, { params: { id: sessionId } });

      expect(await tick(cook, taskId, { status: "completed" })).toMatchObject({ status: 409, body: { code: "PREP_SESSION_ENDED" } });
    });

    it("keeps the client's completedAt (an offline tick), and never a time in the future", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      const earlier = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      await tick(cook, taskId, { status: "completed", completedAt: earlier });
      expect((await taskRow(taskId)).completedAt?.toISOString()).toBe(earlier);

      const other = await newTask(await newSession(), { ingredientId: null });
      const before = Date.now();
      await tick(cook, other, { status: "completed", completedAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString() });
      expect((await taskRow(other)).completedAt!.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await taskRow(other)).completedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("a repeat of the tick does not re-stamp who or when", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      await tick(cook, taskId, { status: "completed", completedAt: "2026-04-10T01:00:00.000Z" });
      const again = await tick(asUser(fx.roamer, ["prep:read"]), taskId, { status: "completed" });
      const row = await taskRow(taskId);

      expect(again.status).toBe(200);
      expect(row.completedBy).toBe(fx.cook);
      expect(row.completedAt?.toISOString()).toBe("2026-04-10T01:00:00.000Z");
    });

    it("an assign that expects 'pending' cannot revert a task another device just completed: 409 PREP_TASK_CHANGED", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      await tick(cook, taskId, { status: "completed" });
      const out = await tick(chef, taskId, { status: "pending", assignedTo: "Sam", expectedStatus: "pending" });

      expect(out).toMatchObject({ status: 409, body: { code: "PREP_TASK_CHANGED" } });
      expect((await taskRow(taskId)).status).toBe("completed");
    });

    it("a tick that is already in the wanted state succeeds even when the expected status is stale (its own retry)", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      await tick(cook, taskId, { status: "completed", expectedStatus: "pending" });
      const retry = await tick(cook, taskId, { status: "completed", expectedStatus: "pending" });
      expect(retry.status).toBe(200);
    });

    it("assignedTo can be cleared with null (the web sends it)", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: null });
      await tick(chef, taskId, { status: "pending", assignedTo: "Sam" });
      const out = await tick(chef, taskId, { status: "pending", assignedTo: null });
      expect(out.status).toBe(200);
      expect((await taskRow(taskId)).assignedTo).toBeNull();
    });
  });

  describe("stock on completion", () => {
    it("deducts once with the tick, writes the consumption row, and puts it back when un-ticked", async () => {
      const before = await stockOf();
      const taskId = await newTask(await newSession(), { qty: 2 });
      await tick(cook, taskId, { status: "completed" });
      await tick(cook, taskId, { status: "completed" });
      expect(await stockOf()).toBe(before - 2);
      const rows = await db.select().from(consumptionLog).where(and(eq(consumptionLog.ingredientId, fx.ingId), eq(consumptionLog.reason, "prep")));
      expect(rows.filter((r) => r.notes === "Prep task: Prep flour").length).toBeGreaterThanOrEqual(1);

      await tick(cook, taskId, { status: "pending" });
      expect(await stockOf()).toBe(before);
    });

    it("a failed deduction rolls the tick back instead of leaving a done task with the stock untouched", async () => {
      const before = await stockOf();
      const taskId = await newTask(await newSession(), { qty: 1 });
      vi.mocked(deductStock).mockRejectedValueOnce(new Error("boom"));

      const out = await tick(cook, taskId, { status: "completed" });

      expect(out.status).toBe(500);
      expect((await taskRow(taskId)).status).toBe("pending");
      expect(await stockOf()).toBe(before);
    });

    it("an ingredient with no stock row at this location is not tracked here: the tick still goes through", async () => {
      const taskId = await newTask(await newSession(), { ingredientId: fx.ingNoStockId });
      const out = await tick(cook, taskId, { status: "completed" });
      expect(out.status).toBe(200);
      expect((await db.select().from(stockLevel).where(eq(stockLevel.ingredientId, fx.ingNoStockId)))).toHaveLength(0);
    });
  });

  describe("generate", () => {
    async function sessionWithSelection() {
      const [mi] = await db
        .insert(menuItem)
        .values({ userId: fx.chef, name: `${fx.tag}-dish`, category: "mains", sellingPrice: "10", servings: 1 })
        .returning({ id: menuItem.menuItemId });
      await db.insert(menuItemIngredient).values({ menuItemId: mi.id, ingredientId: fx.ingId, ingredientName: "Flour", quantity: "1", unit: "kg", unitCost: "2", yieldPct: "100" });
      const sessionId = await newSession();
      const saved = await callHandler(handleSaveSelections, chef, {
        params: { id: sessionId },
        body: { selections: [{ menuItemId: mi.id, dishName: `${fx.tag}-dish`, expectedPortions: 4 }] },
      });
      expect(saved.status).toBe(201);
      return sessionId;
    }

    it("a replay of the same requestId answers with the stored tasks and keeps the progress made since", async () => {
      const sessionId = await sessionWithSelection();
      const requestId = randomUUID();
      const first = await callHandler(handleGenerateFromSelections, chef, { params: { id: sessionId }, body: { requestId } });
      const taskId = first.body[0].prepTaskId;
      await tick(cook, taskId, { status: "completed" });

      const replay = await callHandler(handleGenerateFromSelections, chef, { params: { id: sessionId }, body: { requestId } });

      expect(replay.status).toBe(200);
      expect(replay.body.map((t: { prepTaskId: string }) => t.prepTaskId)).toEqual(first.body.map((t: { prepTaskId: string }) => t.prepTaskId));
      expect((await taskRow(taskId)).status).toBe("completed");
    });

    it("a new requestId, or none (the web), rebuilds the list as before", async () => {
      const sessionId = await sessionWithSelection();
      const first = await callHandler(handleGenerateFromSelections, chef, { params: { id: sessionId }, body: { requestId: randomUUID() } });
      const second = await callHandler(handleGenerateFromSelections, chef, { params: { id: sessionId }, body: {} });

      expect(second.status).toBe(201);
      expect(second.body[0].prepTaskId).not.toBe(first.body[0].prepTaskId);
    });

    it("needs the creator or a prep:manage holder at the location: a colleague with prep:manage may, a cook with prep:read may not", async () => {
      const sessionId = await sessionWithSelection();
      const manager = await callHandler(handleGenerateFromSelections, asUser(fx.roamer, ["prep:manage"]), { params: { id: sessionId }, body: {} });
      const cookTry = await callHandler(handleGenerateFromSelections, cook, { params: { id: sessionId }, body: {} });
      const outsider = await callHandler(handleGenerateFromSelections, stranger, { params: { id: sessionId }, body: {} });

      expect(manager.status).toBe(201);
      expect(cookTry).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
      expect(outsider).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
    });

    it("an ended session is 409 PREP_SESSION_ENDED", async () => {
      const sessionId = await sessionWithSelection();
      await callHandler(handleEndSession, chef, { params: { id: sessionId } });
      const out = await callHandler(handleGenerateFromSelections, chef, { params: { id: sessionId }, body: {} });
      expect(out).toMatchObject({ status: 409, body: { code: "PREP_SESSION_ENDED" } });
    });
  });

  describe("ending a session", () => {
    it("the creator ends it; a repeat succeeds with the same session; a cook with only prep:read cannot", async () => {
      const sessionId = await newSession();
      const refused = await callHandler(handleEndSession, cook, { params: { id: sessionId } });
      const first = await callHandler(handleEndSession, chef, { params: { id: sessionId }, body: { actualCovers: 30 } });
      const again = await callHandler(handleEndSession, chef, { params: { id: sessionId }, body: { actualCovers: 30 } });

      expect(refused).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
      expect(first.body.isEnded).toBe(true);
      expect(again).toMatchObject({ status: 200, body: { isEnded: true, prepSessionId: sessionId } });
    });

    it("a prep:manage colleague at the location may end it; an unknown session is 404 NOT_FOUND", async () => {
      const sessionId = await newSession();
      expect((await callHandler(handleEndSession, asUser(fx.roamer, ["prep:manage"]), { params: { id: sessionId } })).status).toBe(200);
      expect(await callHandler(handleEndSession, chef, { params: { id: randomUUID() } })).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    });
  });

  describe("today's session", () => {
    it("by date and location: a cook finds the chef's session, other dates and other locations do not match", async () => {
      const date = "2026-05-01";
      const made = await callHandler(handleCreateSession, chef, { body: { prepDate: date, storeLocationId: fx.locA } });
      const id = made.body.session.prepSessionId;
      await newTask(id, { ingredientId: null });

      const found = await callHandler(handleGetTodaySession, cook, { query: { date, storeLocationId: fx.locA } });
      const otherDay = await callHandler(handleGetTodaySession, cook, { query: { date: "2026-05-02", storeLocationId: fx.locA } });
      const otherPlace = await callHandler(handleGetTodaySession, cook, { query: { date, storeLocationId: fx.locB } });

      expect(found.status).toBe(200);
      expect(found.body.session.prepSessionId).toBe(id);
      expect(found.body.tasks).toHaveLength(1);
      expect(otherDay.status).toBe(404);
      expect(otherPlace).toMatchObject({ status: 403, body: { code: "LOCATION_NOT_ALLOWED" } });
    });

    it("a date without a location is 400", async () => {
      expect((await callHandler(handleGetTodaySession, cook, { query: { date: "2026-05-01" } })).status).toBe(400);
    });

    it("an ended session is not today's open one", async () => {
      const date = "2026-05-03";
      const made = await callHandler(handleCreateSession, chef, { body: { prepDate: date, storeLocationId: fx.locA } });
      await callHandler(handleEndSession, chef, { params: { id: made.body.session.prepSessionId } });
      expect((await callHandler(handleGetTodaySession, cook, { query: { date, storeLocationId: fx.locA } })).status).toBe(404);
    });
  });

  describe("reading a session", () => {
    it("a member at the location reads a colleague's session; a member of another location does not", async () => {
      const sessionId = await newSession();
      expect((await callHandler(handleGetSession, cook, { params: { id: sessionId } })).status).toBe(200);
      expect((await callHandler(handleGetSession, stranger, { params: { id: sessionId } })).status).toBe(404);
      expect((await callHandler(handleGetSession, boss, { params: { id: sessionId } })).status).toBe(200);
    });
  });
});
