// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { NOW, makePrepHarness, prepHarness, taskRow, todayOf } from "./prepHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/prep/PrepProvider", async () => {
  const { prepHarness } = await import("./prepHarness");
  return {
    usePrep: () => {
      const snap = useSyncExternalStore(prepHarness.store.subscribe, prepHarness.store.getSnapshot);
      return { store: prepHarness.store, canPlan: prepHarness.canPlan, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, useSession: () => sessionState.current };
});
vi.mock("../src/runtime/appOutbox", async () => {
  const { prepHarness } = await import("./prepHarness");
  return { get outbox() { return prepHarness.outbox; }, runner: { kick: vi.fn() } };
});

import Prep from "../app/(app)/(prep)/index";
import PrepPlan from "../app/(app)/(prep)/plan";

const cook = { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["prep:read"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

beforeEach(() => {
  sessionState.current = { state: { phase: "ready", user: cook, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
  prepHarness.canPlan = true;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

const tasks = [
  taskRow({ prepTaskId: "t1", ingredientName: "Onion" }),
  taskRow({ prepTaskId: "t2", ingredientName: "Carrot", priorityTier: "then_these", quantityNeeded: 3, unit: "each", onHandQty: 6, prepNeeded: 0, station: null, prepTimeMinutes: null, taskDescription: "Prep Carrot for Soup" }),
  taskRow({ prepTaskId: "t3", ingredientName: "Stock", priorityTier: "can_wait", status: "completed", completedBy: 7, completedAt: new Date(NOW - 600_000).toISOString() }),
];
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

describe("today's prep list", () => {
  it("shows the day's progress, the tasks grouped in the order a cook works them, with what is needed, what is on hand, station, time and dishes", async () => {
    await makePrepHarness({ today: todayOf(tasks) });
    render(<Prep />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    expect(screen.getByText(/80 covers/)).toBeTruthy();
    expect(screen.getByText(/Start with these/)).toBeTruthy();
    expect(screen.getByText(/Next up/)).toBeTruthy();
    expect(screen.getByText(/Can wait/)).toBeTruthy();
    const onion = screen.getByRole("checkbox", { name: /Onion/ });
    expect(onion.getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByText("4.5 kg")).toHaveLength(2); // Onion and Stock
    expect(screen.getAllByText("1 kg on hand")).toHaveLength(2);
    expect(screen.getAllByText(/Veg · 20 min/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("For Soup, Pie").length).toBeGreaterThan(0);
    expect(screen.getByText("In stock (6 each on hand)")).toBeTruthy();
    expect(screen.queryByText(/waiting to send/i)).toBeNull();
  });

  it("ticks a task at once, shows it waiting to send, and unticking is the same tap", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    render(<Prep />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Onion/ }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Onion/ }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText("2 of 3 done")).toBeTruthy();
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.getByText(/Done by you/)).toBeTruthy();
    expect(t.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Onion/ }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Onion/ }).getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
  });

  it("says who ticked a finished task: a colleague (the server sends an id, not a name), and when", async () => {
    await makePrepHarness({ today: todayOf(tasks) });
    render(<Prep />);
    expect(screen.getByText(/Done by a colleague · 9:50/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Stock/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("skips a task and undoes the skip", async () => {
    await makePrepHarness({ today: todayOf(tasks) });
    render(<Prep />);
    press("Skip Onion");
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo skip Onion" })).toBeTruthy());
    expect(screen.getByText("1 of 3 done")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    press("Undo skip Onion");
    await waitFor(() => expect(screen.getByRole("button", { name: "Skip Onion" })).toBeTruthy());
  });

  it("tells the cook they are offline, and still shows the list that was downloaded last", async () => {
    const t = await makePrepHarness({ today: todayOf(tasks) });
    const offline = await makePrepHarness({ todayFails: new ApiError("network") });
    await offline.kv.set("prep.1.L1", (await t.kv.get("prep.1.L1"))!);
    await offline.prep.refresh();
    render(<Prep />);
    expect(screen.getByText(/You're offline\. Ticks are saved on this phone/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Onion/ })).toBeTruthy();
  });

  it("keeps a refused tick on screen with the server's reason, and offers Try again and Discard (asking first)", async () => {
    const send = vi.fn(async () => { throw new ApiError("conflict", "This prep session has ended", 409, undefined, "PREP_SESSION_ENDED"); });
    const t = await makePrepHarness({ today: todayOf(tasks), send });
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<Prep />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Onion/ }));
    await waitFor(() => expect(screen.getByText("Waiting to send")).toBeTruthy());
    await t.outbox.drain();
    await waitFor(() => expect(screen.getByText(/This prep session has ended/)).toBeTruthy());
    expect(screen.getByText(/1 task needs attention/)).toBeTruthy();
    press("Discard");
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === "Discard")!.onPress!();
    await waitFor(() => expect(screen.queryByText(/This prep session has ended/)).toBeNull());
    expect(screen.getByRole("checkbox", { name: /Onion/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("shows a server error with Try again", async () => {
    await makePrepHarness({ todayFails: new ApiError("forbidden", "You need prep access", 403) });
    render(<Prep />);
    expect(screen.getByText("You need prep access")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("no list yet", () => {
  it("offers to plan today's prep to someone who may, and opens the plan screen", async () => {
    await makePrepHarness({ today: null });
    render(<Prep />);
    expect(screen.getByText("Nothing planned for today yet.")).toBeTruthy();
    press("Plan today's prep");
    expect(routerMock.push).toHaveBeenCalledWith("/plan");
  });

  it("only says so to someone who may not plan (prep:read), with no button", async () => {
    prepHarness.canPlan = false;
    await makePrepHarness({ today: null });
    render(<Prep />);
    expect(screen.getByText(/Ask a manager to plan today's prep/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plan today's prep" })).toBeNull();
  });

  it("shows a list on its way, and a refused step with the reason and Try again", async () => {
    const send = vi.fn(async () => { throw new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"); });
    const t = await makePrepHarness({ today: null, send });
    await t.prep.makeList({ selections: [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 4 }], expectedCovers: null });
    render(<Prep />);
    expect(screen.getByText("Today's prep list is waiting to be made.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plan today's prep" })).toBeNull();
    await t.outbox.drain();
    await waitFor(() => expect(screen.getByText(/You don't work at that location/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("planning today's prep", () => {
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("lists the menu and recipes, takes portions with the steppers or typed, and saves create, dishes and generate on the phone", async () => {
    const t = await makePrepHarness({ today: null });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Soup")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Make today's prep list" }).getAttribute("aria-disabled")).toBe("true");
    press("More Soup");
    press("More Soup");
    type("Portions of Pie", "6");
    type("Portions of House stock", "2");
    type("Expected covers (optional)", "80");
    press("Make today's prep list");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    const entries = await t.outbox.open(["prep.create", "prep.selections", "prep.generate"]);
    expect(entries.map((e) => e.type)).toEqual(["prep.create", "prep.selections", "prep.generate"]);
    expect((entries[0].command as { expectedCovers: number }).expectedCovers).toBe(80);
    expect((entries[1].command as { selections: unknown[] }).selections).toEqual([
      { menuItemId: "m1", dishName: "Soup", expectedPortions: 2, category: "Starter" },
      { menuItemId: "m2", dishName: "Pie", expectedPortions: 6, category: "Main" },
      { recipeId: "r1", dishName: "House stock", expectedPortions: 2 },
    ]);
  });

  it("fills the portions from the last plan, for the dishes still on the menu", async () => {
    await makePrepHarness({ today: null, previous: [{ menuItemId: "m1", recipeId: null, dishName: "Soup", expectedPortions: 12, category: null }, { menuItemId: "gone", recipeId: null, dishName: "Old dish", expectedPortions: 3, category: null }] });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Use the last plan's portions" })).toBeTruthy());
    press("Use the last plan's portions");
    expect((screen.getByLabelText("Portions of Soup") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("Portions of Pie") as HTMLInputElement).value).toBe("0");
  });

  it("finds a dish by typing part of its name", async () => {
    await makePrepHarness({ today: null });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Soup")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Find a dish"), { target: { value: "pi" } });
    expect(screen.queryByText("Soup")).toBeNull();
    expect(screen.getByText("Pie")).toBeTruthy();
  });

  it("shows a refusal from the store (a list that already exists) and stays on the screen", async () => {
    const t = await makePrepHarness({ today: null });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Soup")).toBeTruthy());
    press("More Soup");
    t.serverToday.current = todayOf();
    press("Make today's prep list");
    await waitFor(() => expect(screen.getByText("Today's prep list is already made.")).toBeTruthy());
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("says it needs signal the first time, and works from the saved menu after that", async () => {
    await makePrepHarness({ today: null, menuFails: new ApiError("network") });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Connect to the internet once to load your menu.")).toBeTruthy());
    cleanup();
    const first = await makePrepHarness({ today: null });
    await first.prep.loadChoices();
    const second = await makePrepHarness({ today: null, menuFails: new ApiError("network") });
    await second.kv.set("prep.menu.1", (await first.kv.get("prep.menu.1"))!);
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Soup")).toBeTruthy());
    expect(screen.getByText(/saved on this phone/)).toBeTruthy();
  });

  it("does not offer planning to someone without prep:manage", async () => {
    prepHarness.canPlan = false;
    await makePrepHarness({ today: null });
    render(<PrepPlan />);
    expect(screen.getByText(/Ask a manager to plan today's prep/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make today's prep list" })).toBeNull();
  });
});

describe("tablet width", () => {
  const widthOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).maxWidth);

  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("keeps the list in the app's one column, centred, on %s", async (_n, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    await makePrepHarness({ today: todayOf(tasks) });
    render(<Prep />);
    const column = screen.getByText("Main Kitchen").parentElement as HTMLElement;
    expect(widthOf(column)).toBe(560);
    expect(getComputedStyle(column).width).toBe("100%");
    expect(getComputedStyle(column).alignSelf).toBe("center");
  });

  it("keeps the plan screen in the same column", async () => {
    window.innerWidth = 820;
    await makePrepHarness({ today: null });
    render(<PrepPlan />);
    await waitFor(() => expect(screen.getByText("Soup")).toBeTruthy());
    const column = screen.getByRole("heading", { name: "Plan today's prep" }).parentElement as HTMLElement;
    expect(widthOf(column)).toBe(560);
    expect(getComputedStyle(column).alignSelf).toBe("center");
  });
});
