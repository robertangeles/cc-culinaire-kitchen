/**
 * Baseline integration tests for prepService — real DB, TENANT_IT=1 gated.
 * Goal: regression signal for the Phase 2e barrel split. Happy-path only.
 * Self-cleaning: afterAll removes all created rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  user,
  menuItem,
  menuItemIngredient,
  prepSession,
  prepMenuSelection,
  prepTask,
  ingredientCrossUsage,
} from "../db/schema.js";
import {
  createPrepSession,
  getMenuForSelection,
  suggestSelections,
  saveMenuSelections,
  generateTasksFromSelections,
  updateTaskStatus,
} from "./prepService.js";

const RUN = process.env.TENANT_IT === "1";

const fx = {
  tag: `prep_${Date.now().toString(36)}`,
  userId: 0,
  menuItemId: "",
  sessionId: "",
  taskId: "",
};

describe.skipIf(!RUN)("prepService — baseline integration (real DB)", () => {
  beforeAll(async () => {
    [{ userId: fx.userId }] = await db
      .insert(user)
      .values({ userName: "Prep IT", userEmail: `${fx.tag}@it.test` })
      .returning({ userId: user.userId });

    [{ menuItemId: fx.menuItemId }] = await db
      .insert(menuItem)
      .values({
        userId: fx.userId,
        name: `${fx.tag}-burger`,
        category: "mains",
        sellingPrice: "18.00",
        classification: "star",
        unitsSold: 20,
      })
      .returning({ menuItemId: menuItem.menuItemId });

    await db.insert(menuItemIngredient).values({
      menuItemId: fx.menuItemId,
      ingredientId: null,
      ingredientName: "Beef patty",
      quantity: "200",
      unit: "g",
      unitCost: "2.00",
      yieldPct: "90",
    });
  });

  afterAll(async () => {
    if (fx.sessionId) {
      await db.delete(ingredientCrossUsage).where(eq(ingredientCrossUsage.prepSessionId, fx.sessionId));
      await db.delete(prepTask).where(eq(prepTask.prepSessionId, fx.sessionId));
      await db.delete(prepMenuSelection).where(eq(prepMenuSelection.prepSessionId, fx.sessionId));
      await db.delete(prepSession).where(eq(prepSession.prepSessionId, fx.sessionId));
    }
    if (fx.menuItemId) {
      await db.delete(menuItemIngredient).where(eq(menuItemIngredient.menuItemId, fx.menuItemId));
      await db.delete(menuItem).where(eq(menuItem.menuItemId, fx.menuItemId));
    }
    if (fx.userId) {
      await db.delete(user).where(eq(user.userId, fx.userId));
    }
  });

  it("createPrepSession — creates a session for a date", async () => {
    const result = await createPrepSession(fx.userId, "2026-09-28", 40);
    expect(result.session.prepSessionId).toBeTruthy();
    expect(result.session.prepDate).toBe("2026-09-28");
    expect(result.session.tasksTotal).toBe(0);
    expect(result.session.isEnded).toBe(false);
    fx.sessionId = result.session.prepSessionId;
  });

  it("getMenuForSelection — returns the menu item we seeded", async () => {
    const result = await getMenuForSelection(fx.userId);
    expect(result.hasMenuItems).toBe(true);
    const found = result.menuItems.find((m) => m.menuItemId === fx.menuItemId);
    expect(found).toBeDefined();
    expect(found!.name).toBe(`${fx.tag}-burger`);
    expect(found!.category).toBe("mains");
  });

  it("suggestSelections — returns suggestions for 10 covers", async () => {
    const result = await suggestSelections(fx.userId, 10);
    expect(result.covers).toBe(10);
    expect(result.hasMenuItems).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
    const burger = result.suggestions.find((s) => s.menuItemId === fx.menuItemId);
    expect(burger).toBeDefined();
    expect(burger!.suggestedPortions).toBeGreaterThanOrEqual(0);
  });

  it("saveMenuSelections — persists dish picks for a session", async () => {
    const selections = await saveMenuSelections(fx.sessionId, fx.userId, [
      { menuItemId: fx.menuItemId, dishName: `${fx.tag}-burger`, expectedPortions: 10 },
    ]);
    expect(selections).toHaveLength(1);
    expect(selections[0].menuItemId).toBe(fx.menuItemId);
    expect(selections[0].expectedPortions).toBe(10);
  });

  it("generateTasksFromSelections — generates tasks from saved selections", async () => {
    const tasks = await generateTasksFromSelections(fx.sessionId, fx.userId);
    expect(tasks.length).toBeGreaterThan(0);
    const beefTask = tasks.find((t) => t.ingredientName === "Beef patty");
    expect(beefTask).toBeDefined();
    expect(beefTask!.quantityNeeded).toBeGreaterThan(0);
    expect(beefTask!.unit).toBe("g");
    fx.taskId = tasks[0].prepTaskId;
  });

  it("updateTaskStatus — marks a task in_progress", async () => {
    const updated = await updateTaskStatus(fx.taskId, fx.userId, "in_progress");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("in_progress");
  });

  it("updateTaskStatus — marks a task completed", async () => {
    const updated = await updateTaskStatus(fx.taskId, fx.userId, "completed");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("completed");
    expect(updated!.completedAt).not.toBeNull();
  });
});
