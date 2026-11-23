import { describe, it, expect, vi } from "vitest";
import { ApiError, type ApiClient } from "../api/client";
import { createPrepApi } from "./prepApi";

// The real client parses each reply with the schema it is given; so does this stand-in.
const client = (reply: (path: string) => unknown) => ({ request: vi.fn(async (_m: string, path: string, opts: { schema: { parse(d: unknown): unknown } }) => opts.schema.parse(reply(path))) }) as unknown as ApiClient & { request: ReturnType<typeof vi.fn> };

const session = { prepSessionId: "s1", userId: 7, prepDate: "2026-11-23", expectedCovers: null, actualCovers: null, tasksTotal: 1, tasksCompleted: 0, tasksSkipped: 0, isEnded: false };

describe("prep calls", () => {
  it("asks for the open session of one local date at one location, whoever made it", async () => {
    const c = client(() => ({ session, tasks: [{ prepTaskId: "t1", prepSessionId: "s1", ingredientName: "Onion", quantityNeeded: "4.500", unit: "kg" }] }));
    const today = await createPrepApi(c).today("2026-11-23", "L 1");
    expect(c.request.mock.calls[0].slice(0, 2)).toEqual(["GET", "/api/prep/sessions/today?date=2026-11-23&storeLocationId=L%201"]);
    expect(today?.tasks[0]).toMatchObject({ prepTaskId: "t1", quantityNeeded: 4.5 });
  });

  it("answers null when there is no prep for today (the server's 404), and lets any other failure through", async () => {
    const none = { request: vi.fn(async () => { throw new ApiError("not_found", "No prep session for today", 404); }) } as unknown as ApiClient;
    expect(await createPrepApi(none).today("2026-11-23", "L1")).toBeNull();
    const down = { request: vi.fn(async () => { throw new ApiError("network"); }) } as unknown as ApiClient;
    await expect(createPrepApi(down).today("2026-11-23", "L1")).rejects.toMatchObject({ code: "network" });
    const forbidden = { request: vi.fn(async () => { throw new ApiError("forbidden", "no", 403); }) } as unknown as ApiClient;
    await expect(createPrepApi(forbidden).today("2026-11-23", "L1")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reads the menu of the whole organisation, as the web does by default, and the previous selections", async () => {
    const c = client((path) => (path.includes("previous") ? [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 12 }] : { menuItems: [{ menuItemId: "m1", name: "Soup", category: "Starter" }], recipes: [] }));
    const api = createPrepApi(c);
    expect((await api.menu()).menuItems).toHaveLength(1);
    expect(await api.previousSelections()).toEqual([{ menuItemId: "m1", recipeId: null, dishName: "Soup", expectedPortions: 12, category: null }]);
    expect(c.request.mock.calls.map((x) => x[1])).toEqual(["/api/prep/menu?teamView=true", "/api/prep/previous-selections?teamView=true"]);
  });
});
