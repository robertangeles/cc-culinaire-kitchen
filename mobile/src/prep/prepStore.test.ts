import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../api/client";
import { NOW, TODAY, makePrepHarness, taskRow, todayOf } from "../../tests/prepHarness";

const tasks = [taskRow({ prepTaskId: "t1", ingredientName: "Onion" }), taskRow({ prepTaskId: "t2", ingredientName: "Carrot", priorityTier: "then_these" }), taskRow({ prepTaskId: "t3", ingredientName: "Stock", priorityTier: "can_wait" })];

describe("loading today", () => {
  it("shows today's list from the server, asked for by the phone's local date and the current location, and keeps it for no-signal starts", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    expect(t.api.today).toHaveBeenCalledWith(TODAY, "L1");
    expect(t.prep.getSnapshot()).toMatchObject({ phase: "ready", offline: false });
    expect(t.prep.getSnapshot().list.rows.map((r) => r.ingredientName)).toEqual(["Onion", "Carrot", "Stock"]);

    const offline = await makePrepHarness({ todayFails: new ApiError("network") });
    await offline.kv.set("prep.1.L1", (await t.kv.get("prep.1.L1"))!);
    await offline.prep.refresh();
    expect(offline.prep.getSnapshot()).toMatchObject({ phase: "ready", offline: true });
    expect(offline.prep.getSnapshot().list.rows).toHaveLength(3);
  });

  it("does not show yesterday's saved list as today's when offline", async () => {
    const t = await makePrepHarness({ todayFails: new ApiError("network") });
    await t.kv.set("prep.1.L1", JSON.stringify({ date: "2026-11-22", today: todayOf(tasks) }));
    await t.prep.refresh();
    expect(t.prep.getSnapshot().list.rows).toEqual([]);
  });

  it("is ready and empty when nothing is planned, offline with no saved list, and shows other failures as errors", async () => {
    expect((await makePrepHarness({ today: null })).prep.getSnapshot()).toMatchObject({ phase: "ready", offline: false, list: { session: null, rows: [] } });
    expect((await makePrepHarness({ todayFails: new ApiError("network") })).prep.getSnapshot()).toMatchObject({ phase: "ready", offline: true });
    expect((await makePrepHarness({ todayFails: new ApiError("forbidden", "You need prep access", 403) })).prep.getSnapshot()).toMatchObject({ phase: "error", error: "You need prep access" });
  });

  it("keeps the saved list per account and location", async () => {
    const a = await makePrepHarness({ today: todayOf(tasks), userId: 1 });
    const b = await makePrepHarness({ today: todayOf(tasks), userId: 2, locationId: "L2" });
    expect(await a.kv.get("prep.1.L1")).toBeTruthy();
    expect(await b.kv.get("prep.2.L2")).toBeTruthy();
    expect(await b.kv.get("prep.1.L1")).toBeNull();
  });
});

describe("ticking", () => {
  it("saves the tick on the phone first: the row is done and waiting at once, nothing is sent, and the sender is kicked", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    await t.prep.setStatus("t1", "completed");
    const row = t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")!;
    expect(row).toMatchObject({ status: "completed", sync: "waiting", completedBy: 1, completedAt: new Date(NOW).toISOString() });
    expect(t.prep.getSnapshot()).toMatchObject({ waiting: 1, attention: 0 });
    expect(t.prep.getSnapshot().list.progress.done).toBe(1);
    expect(t.request).not.toHaveBeenCalled();
    expect(t.kick).toHaveBeenCalled();
  });

  it("sends it when the queue drains, and the row is sent", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    await t.prep.setStatus("t1", "completed");
    t.serverToday.current = todayOf(tasks.map((x) => (x.prepTaskId === "t1" ? { ...x, status: "completed", completedBy: 1, completedAt: new Date(NOW).toISOString() } : x)));
    await t.outbox.drain();
    await vi.waitFor(() => expect(t.prep.getSnapshot()).toMatchObject({ waiting: 0 }));
    expect(t.request).toHaveBeenCalledWith("PATCH", "/api/prep/tasks/t1", { body: { status: "completed", completedAt: new Date(NOW).toISOString() } });
    await vi.waitFor(() => expect(t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")).toMatchObject({ status: "completed", sync: "synced" }));
  });

  it("keeps the tick on screen as done the moment it is accepted, while the server's list is still being read again", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    await t.prep.setStatus("t1", "completed");
    t.api.today.mockImplementation(() => new Promise(() => {})); // the re-read is on its way
    await t.outbox.drain();
    await vi.waitFor(() => expect(t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")).toMatchObject({ status: "completed", sync: "synced", completedBy: 1 }));
    expect(t.api.today).toHaveBeenCalledTimes(2);
  });

  it("unticks and skips with the same command, and asking for the status a row already has does nothing", async () => {
    const t = await makePrepHarness({ today: todayOf([taskRow({ status: "completed", completedBy: 5 })]) });
    await t.prep.setStatus("t1", "completed");
    expect(t.kick).not.toHaveBeenCalled();
    await t.prep.setStatus("t1", "pending");
    expect(t.prep.getSnapshot().list.rows[0]).toMatchObject({ status: "pending", completedBy: null });
    await t.prep.setStatus("t1", "skipped");
    expect(t.prep.getSnapshot().list.rows[0]).toMatchObject({ status: "skipped" });
    expect((await t.outbox.open(["prep.tick"])).length).toBe(1);
  });

  it("refuses a task that is not on the list", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    await expect(t.prep.setStatus("nope", "completed")).rejects.toThrow("That task is not on today's list.");
  });

  it("shows a refused tick on its row with the server's reason, and Try again sends it again; Discard drops it and the row goes back", async () => {
    const send = vi.fn(async () => { throw new ApiError("conflict", "This prep session has ended", 409, undefined, "PREP_SESSION_ENDED"); });
    const t = await makePrepHarness({ today: todayOf(tasks), send });
    await t.prep.setStatus("t1", "completed");
    await t.outbox.drain();
    const stuck = t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")!;
    expect(stuck).toMatchObject({ status: "completed", sync: "attention", attentionMessage: "This prep session has ended" });
    expect(t.prep.getSnapshot()).toMatchObject({ attention: 1, waiting: 0 });

    await t.prep.retry(stuck.entryId!);
    expect(t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")).toMatchObject({ sync: "waiting" });

    await t.outbox.drain();
    await t.prep.discard(t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")!.entryId!);
    expect(t.prep.getSnapshot().list.rows.find((r) => r.prepTaskId === "t1")).toMatchObject({ status: "pending", sync: "synced" });
  });

  it("ignores a read that started before a newer one (an older answer never replaces a newer one)", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    let release!: (v: ReturnType<typeof todayOf>) => void;
    t.api.today.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const slow = t.prep.refresh();
    t.api.today.mockResolvedValueOnce(todayOf([taskRow({ prepTaskId: "newer", ingredientName: "Newer" })]));
    await t.prep.refresh();
    release(todayOf([taskRow({ prepTaskId: "older", ingredientName: "Older" })]));
    await slow;
    expect(t.prep.getSnapshot().list.rows.map((r) => r.ingredientName)).toEqual(["Newer"]);
  });
});

describe("making today's list", () => {
  const picks = [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 12 }, { recipeId: "r1", dishName: "House stock", expectedPortions: 2 }];

  it("saves create, dishes and generate on the phone in one go, under one id the phone made, and shows the list as being made", async () => {
    const t = await makePrepHarness({ today: null });
    await t.prep.makeList({ selections: picks, expectedCovers: 80 });
    const entries = await t.outbox.open(["prep.create", "prep.selections", "prep.generate"]);
    expect(entries.map((e) => e.type)).toEqual(["prep.create", "prep.selections", "prep.generate"]);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(entries[0].command).toEqual({ prepSessionId: id, storeLocationId: "L1", prepDate: TODAY, expectedCovers: 80 });
    expect(entries[1].command).toEqual({ prepSessionId: id, selections: picks });
    expect(entries[2].command).toEqual({ prepSessionId: id, requestId: "00000000-0000-4000-8000-000000000002" });
    expect(t.prep.getSnapshot().list.plan).toMatchObject({ sync: "waiting" });
    expect(t.prep.getSnapshot().waiting).toBe(3);
    expect(t.kick).toHaveBeenCalled();
    expect(t.request).not.toHaveBeenCalled();
  });

  it("sends the whole plan in order, and reads the finished list from the server once generate is accepted", async () => {
    const t = await makePrepHarness({ today: null });
    await t.prep.makeList({ selections: picks, expectedCovers: null });
    t.serverToday.current = todayOf(tasks, { prepSessionId: "00000000-0000-4000-8000-000000000001" });
    await t.outbox.drain();
    expect(t.request.mock.calls.map((c) => c[1])).toEqual(["/api/prep/sessions", "/api/prep/sessions/00000000-0000-4000-8000-000000000001/selections", "/api/prep/sessions/00000000-0000-4000-8000-000000000001/generate"]);
    await vi.waitFor(() => expect(t.prep.getSnapshot().list.rows).toHaveLength(3));
    expect(t.prep.getSnapshot().list.plan).toBeNull();
  });

  it("uses the session that already exists on the server when it has no tasks yet, and does not create another", async () => {
    const t = await makePrepHarness({ today: todayOf([]) });
    await t.prep.makeList({ selections: picks, expectedCovers: null });
    const entries = await t.outbox.open(["prep.create", "prep.selections", "prep.generate"]);
    expect(entries.map((e) => e.type)).toEqual(["prep.selections", "prep.generate"]);
    expect((entries[0].command as { prepSessionId: string }).prepSessionId).toBe("s1");
  });

  it("reads the server again first, so a list a colleague made a moment ago is not made twice", async () => {
    const t = await makePrepHarness({ today: null });
    t.serverToday.current = todayOf(tasks);
    await expect(t.prep.makeList({ selections: picks, expectedCovers: null })).rejects.toThrow("Today's prep list is already made.");
    expect(await t.outbox.open(["prep.create"])).toEqual([]);
  });

  it("does not make a second list while one is on its way, and never rebuilds a list that has ticks on it", async () => {
    const t = await makePrepHarness({ today: null });
    await t.prep.makeList({ selections: picks, expectedCovers: null });
    await expect(t.prep.makeList({ selections: picks, expectedCovers: null })).rejects.toThrow("Today's prep list is already being made.");
    const made = await makePrepHarness({ today: todayOf(tasks) });
    await expect(made.prep.makeList({ selections: picks, expectedCovers: null })).rejects.toThrow("Today's prep list is already made.");
  });

  it("checks the dishes and covers before saving anything", async () => {
    const t = await makePrepHarness({ today: null });
    await expect(t.prep.makeList({ selections: [], expectedCovers: null })).rejects.toThrow("Pick at least one dish.");
    await expect(t.prep.makeList({ selections: [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 0 }], expectedCovers: null })).rejects.toThrow("Every dish needs at least one portion.");
    await expect(t.prep.makeList({ selections: picks, expectedCovers: 0 })).rejects.toThrow("Covers must be a whole number above zero.");
    expect(await t.outbox.open(["prep.create", "prep.selections", "prep.generate"])).toEqual([]);
  });

  it("shows a refused step with its reason; discarding the create takes the rest of the plan with it", async () => {
    const send = vi.fn(async () => { throw new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"); });
    const t = await makePrepHarness({ today: null, send });
    await t.prep.makeList({ selections: picks, expectedCovers: null });
    await t.outbox.drain();
    const plan = t.prep.getSnapshot().list.plan!;
    expect(plan).toMatchObject({ sync: "attention", message: "You don't work at that location" });
    await t.prep.discard(plan.entryId!);
    expect(t.prep.getSnapshot().list.plan).toBeNull();
    expect(t.prep.getSnapshot()).toMatchObject({ waiting: 0, attention: 0 });
  });
});

describe("the dishes to pick from", () => {
  it("loads the menu and the last plan, and keeps the menu for the next time with no signal", async () => {
    const t = await makePrepHarness({ today: null, previous: [{ menuItemId: "m1", recipeId: null, dishName: "Soup", expectedPortions: 12, category: null }] });
    const first = await t.prep.loadChoices();
    expect(first.offline).toBe(false);
    expect(first.menu.menuItems.map((m) => m.name)).toEqual(["Soup", "Pie"]);
    expect(first.previous).toHaveLength(1);

    const offline = await makePrepHarness({ today: null, menuFails: new ApiError("network") });
    await offline.kv.set("prep.menu.1", (await t.kv.get("prep.menu.1"))!);
    const again = await offline.prep.loadChoices();
    expect(again.offline).toBe(true);
    expect(again.menu.menuItems).toHaveLength(2);
    expect(again.previous).toEqual([]);
  });

  it("says it needs signal the first time, and shows any other failure as it is", async () => {
    await expect((await makePrepHarness({ today: null, menuFails: new ApiError("network") })).prep.loadChoices()).rejects.toThrow("Connect to the internet once to load your menu.");
    await expect((await makePrepHarness({ today: null, menuFails: new ApiError("forbidden", "No prep access", 403) })).prep.loadChoices()).rejects.toThrow("No prep access");
  });
});
