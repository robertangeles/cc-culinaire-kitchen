// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { makeMenu, menuItem } from "./menuHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

const picks = vi.hoisted(() => ({ next: [] as unknown[] }));
vi.mock("../src/menu/pickCsv", () => ({ pickCsv: async () => picks.next.shift() ?? { kind: "cancelled" } }));
vi.mock("../src/menu/MenuProvider", async () => {
  const { menu } = await import("./menuHarness");
  return {
    useMenu: () => {
      const snap = useSyncExternalStore(menu.store.subscribe, menu.store.getSnapshot);
      return { store: menu.store, api: menu.api, recents: menu.recents, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});

import MenuHome from "../app/(app)/(menu)/index";
import MenuDashboard from "../app/(app)/(menu)/menu-dashboard";
import MenuMatrix from "../app/(app)/(menu)/menu-matrix";
import MenuImport from "../app/(app)/(menu)/menu-import";
import MenuItemScreen from "../app/(app)/(menu)/menu-item/[menuItemId]";
import MenuSale from "../app/(app)/(menu)/menu-sale";

const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const signIn = (permissions: string[]) => (sessionState.current = { state: { phase: "ready", user: { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions }, location: main, locations: [main] }, busy: false });
const MANAGER = ["menu:read", "menu:manage", "inventory:cost"];
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const settle = () => act(async () => {});
const csv = { kind: "picked", csv: { name: "sales.csv", bytes: new Uint8Array([1]) } };

const items = [
  menuItem(),
  menuItem({ menuItemId: "m2", name: "Affogato", category: "Desserts", sellingPrice: 12, foodCost: 2, foodCostPct: 16.67, contributionMargin: 10, unitsSold: 4, menuMixPct: 25, classification: "puzzle" }),
  menuItem({ menuItemId: "m3", name: "Minestrone", category: "Soups", sellingPrice: 9, foodCost: 4, foodCostPct: 44.44, contributionMargin: 5, unitsSold: 2, menuMixPct: 15, classification: "dog" }),
];

beforeEach(() => {
  vi.restoreAllMocks();
  signIn(MANAGER);
  searchParams.current = {};
  picks.next = [];
});

describe("the menu dashboard", () => {
  it("shows the classes, the cost figures, the top and bottom and the Dogs to a cost holder, and opens an item", async () => {
    await makeMenu({ items });
    render(<MenuDashboard />);
    for (const label of ["Stars, 1, High profit, high popularity", "Dogs, 1, Low profit, low popularity", "Items analysed, 3", "Average food cost, 28.8%", "Average margin, $10.97"]) expect(screen.getByLabelText(label)).toBeTruthy();
    press("Highest margin: Margherita, $17.90 margin");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: "m1" } });
    press("Least popular: Minestrone, 15.0% of sales");
    press("Minestrone, Soups");
    press("Engineering matrix");
    expect(routerMock.push).toHaveBeenCalledWith("/menu-matrix");
  });

  it("shows someone without inventory:cost the classes and popularity, and no cost figure, margin or matrix at all", async () => {
    signIn(["menu:read"]);
    await makeMenu({ items, canSeeCost: false });
    render(<MenuDashboard />);
    expect(screen.getByLabelText("Items analysed, 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Most popular: Margherita, 60.0% of sales" })).toBeTruthy();
    expect(screen.queryByText(/food cost|margin|\$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Engineering matrix" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recalculate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import units sold from a CSV" })).toBeNull();
  });

  it("recalculates for a menu:manage holder and reads the menu again, saying when it needs a connection", async () => {
    const t = await makeMenu({ items });
    render(<MenuDashboard />);
    t.api.recalculate.mockRejectedValueOnce(new ApiError("network"));
    press("Recalculate");
    expect(await screen.findByText(/Not recalculated: this needs a connection/)).toBeTruthy();
    await settle();
    press("Recalculate");
    expect(await screen.findByText("Every item was priced again and classified.")).toBeTruthy();
    expect(t.api.items).toHaveBeenCalledTimes(2);
    press("Import units sold from a CSV");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-import", params: { kind: "units" } });
  });

  it("says an empty menu in a card", async () => {
    await makeMenu({ items: [] });
    render(<MenuDashboard />);
    expect(screen.getByText("No menu data yet")).toBeTruthy();
  });

  it("is reached from the menu, and the matrix only with inventory:cost", async () => {
    await makeMenu({ items });
    const { unmount } = render(<MenuHome />);
    press("Dashboard");
    press("Engineering matrix");
    expect(routerMock.push).toHaveBeenCalledWith("/menu-dashboard");
    expect(routerMock.push).toHaveBeenCalledWith("/menu-matrix");
    unmount();
    signIn(["menu:read"]);
    await makeMenu({ items, canSeeCost: false });
    render(<MenuHome />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Engineering matrix" })).toBeNull();
  });
});

describe("the engineering matrix", () => {
  it("places every item that sold, shows a picked dot's figures and lists the items by class", async () => {
    await makeMenu({ items });
    render(<MenuMatrix />);
    press("Affogato: margin $10.00, 25.0% of sales, Puzzle");
    expect(screen.getByText("Puzzle · Margin $10.00 · 25.0% of sales")).toBeTruthy();
    press("Open Affogato");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: "m2" } });
    expect(screen.getByText("Stars · 1")).toBeTruthy();
    expect(screen.getByText("Plowhorses · 0")).toBeTruthy();
    press("Minestrone, margin $5.00, 15.0% of sales");
  });

  it("says when fewer than two items sold", async () => {
    await makeMenu({ items: [items[0], menuItem({ menuItemId: "m9", unitsSold: 0, menuMixPct: 0 })] });
    render(<MenuMatrix />);
    expect(screen.getByText("Not enough sales yet")).toBeTruthy();
  });
});

describe("an item's waste, plate P&L, yield variance and recommendations", () => {
  beforeEach(() => void (searchParams.current = { menuItemId: "m3" }));
  const variance = { status: "ok", theoretical: 20, actual: 23, variance: 3, variancePct: 15, threshold: "alert", unitsSold: 2, consumptionLogCount: 4, periodStart: "2026-11-01", periodEnd: "2026-11-27" };

  it("shows a cost holder the waste, the plate P&L and the yield variance", async () => {
    await makeMenu({ items, waste: [{ menuItemId: "m3", wasteEstimate: 41.2 }], plateCost: 3.5, variance });
    render(<MenuItemScreen />);
    expect(await screen.findByLabelText("Food cost per serving, $3.50")).toBeTruthy();
    for (const label of ["Ingredient waste, last 30 days, $41.20", "Price per serving, $9.00", "Margin per serving, $5.50", "The recipe says, $20.00", "Logged as used, $23.00", "Difference, $3.00 (15.0%)"]) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText("A Dog with waste: a strong candidate to replace.")).toBeTruthy();
    expect(screen.getByText("15.0% more than the recipe says. Check portions and waste.")).toBeTruthy();
    expect(screen.getByText("2 sold, 2026-11-01 to 2026-11-27")).toBeTruthy();
  });

  it("shows none of them without inventory:cost, and asks the server for none", async () => {
    signIn(["menu:read"]);
    const t = await makeMenu({ items, canSeeCost: false, waste: [{ menuItemId: "m3", wasteEstimate: 41.2 }], plateCost: 3.5, variance });
    render(<MenuItemScreen />);
    await screen.findByText("Mozzarella");
    expect(screen.queryByText(/Plate P&L|Yield variance|waste|Recommendations/i)).toBeNull();
    expect(t.api.yieldVariance).not.toHaveBeenCalled();
    expect(t.api.wasteImpact).not.toHaveBeenCalled();
  });

  it("asks for recommendations with menu:manage only, and opens the Recipe Lab with a replacement's request", async () => {
    const t = await makeMenu({ items });
    t.api.recommendations.mockResolvedValueOnce({ summary: "A Dog: rework it.", actions: [{ type: "raise_price", description: "Charge $11.", impact: "+$2 a plate" }, { type: "generate_replacement", description: "Replace it with a lighter soup." }], menuDescription: "Slow-cooked vegetables." });
    render(<MenuItemScreen />);
    press("Get recommendations");
    expect(await screen.findByText("A Dog: rework it.")).toBeTruthy();
    expect(screen.getByText("Raise price")).toBeTruthy();
    expect(screen.getByText("+$2 a plate")).toBeTruthy();
    expect(screen.getByText("“Slow-cooked vegetables.”")).toBeTruthy();
    press("Write a replacement recipe");
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/recipe-lab", params: { request: 'Generate a replacement recipe for "Margherita".' } }));
  });

  it("shows the model's failure in the server's words and lets the person ask again", async () => {
    const t = await makeMenu({ items });
    t.api.recommendations.mockRejectedValueOnce(new ApiError("server", "The AI service could not complete that. Please try again.", 503, undefined, "AI_UNAVAILABLE"));
    render(<MenuItemScreen />);
    press("Get recommendations");
    expect(await screen.findByText("The AI service could not complete that. Please try again.")).toBeTruthy();
    await settle();
    press("Get recommendations");
    await waitFor(() => expect(t.api.recommendations).toHaveBeenCalledTimes(2));
  });

  it("offers no recommendations without menu:manage", async () => {
    signIn(["menu:read", "inventory:cost"]);
    await makeMenu({ items });
    render(<MenuItemScreen />);
    await screen.findByText("Mozzarella");
    expect(screen.queryByRole("button", { name: "Get recommendations" })).toBeNull();
  });

  it("marks a row's waste on the menu list for a cost holder", async () => {
    await makeMenu({ items, waste: [{ menuItemId: "m3", wasteEstimate: 41.2 }] });
    render(<MenuHome />);
    expect(screen.getByText("Dog + $41 waste")).toBeTruthy();
  });
});

describe("importing a sales CSV", () => {
  it("matches the rows first, records them at this location on a press, and says what happened to each", async () => {
    searchParams.current = { kind: "sales" };
    const t = await makeMenu({ items });
    t.api.previewSales.mockResolvedValueOnce({ matched: [{ rowIndex: 1, menuItemId: "m1", name: "Margherita", qtySold: 2 }, { rowIndex: 2, menuItemId: "m2", name: "Affogato", qtySold: 1, soldAt: "2026-11-27T19:00" }], unmatched: [{ rowIndex: 3, name: "Pizza", reason: "no matching menu item" }] });
    t.api.commitSales.mockResolvedValueOnce({ succeeded: [{}], alreadyExists: [{}], failed: [{ rowIndex: 2, reason: "not enough stock" }] });
    render(<MenuImport />);
    expect(screen.getByText(/recorded as a sale at Main Kitchen/)).toBeTruthy();
    picks.next = [csv];
    press("Choose a CSV file");
    expect(await screen.findByText("Margherita × 2")).toBeTruthy();
    expect(screen.getByText("Pizza")).toBeTruthy();
    expect(screen.getByText("no matching menu item")).toBeTruthy();
    expect(t.api.commitSales).not.toHaveBeenCalled();
    press("Record 2 sales");
    expect(await screen.findByText("1 recorded")).toBeTruthy();
    expect(screen.getByText("1 already imported · 1 not recorded")).toBeTruthy();
    expect(screen.getByText("not enough stock")).toBeTruthy();
    expect(t.api.commitSales).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: "Margherita", qtySold: 2 })]));
  });

  it("after no answer, keeps the rows to send again, and says a refused file in the picker's words", async () => {
    const t = await makeMenu({ items });
    t.api.previewSales.mockResolvedValueOnce({ matched: [{ rowIndex: 1, menuItemId: "m1", name: "Margherita", qtySold: 2 }], unmatched: [] });
    t.api.commitSales.mockRejectedValueOnce(new ApiError("timeout"));
    render(<MenuImport />);
    picks.next = [{ kind: "refused", reason: "Pick a .csv file." }];
    press("Choose a CSV file");
    expect(await screen.findByText("Pick a .csv file.")).toBeTruthy();
    picks.next = [csv];
    press("Choose a CSV file");
    fireEvent.click(await screen.findByRole("button", { name: "Record 1 sale" }));
    expect(await screen.findByText(/No answer from the server.*not recorded twice/)).toBeTruthy();
    await settle();
    press("Record 1 sale");
    await waitFor(() => expect(t.api.commitSales).toHaveBeenCalledTimes(2));
  });

  it("is reached from Record a sale", async () => {
    await makeMenu({ items });
    render(<MenuSale />);
    press("Import sales from a CSV");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-import", params: { kind: "sales" } });
  });
});

describe("importing units sold", () => {
  it("sets units sold for a menu:manage holder and names the rows it could not match", async () => {
    searchParams.current = { kind: "units" };
    const t = await makeMenu({ items });
    t.api.importUnits.mockResolvedValueOnce({ updated: 2, notFound: ["Pizza (ambiguous name: multiple menu items)"] });
    render(<MenuImport />);
    expect(screen.getByText("Import units sold")).toBeTruthy();
    picks.next = [csv];
    press("Choose a CSV file");
    expect(await screen.findByText("2 items updated")).toBeTruthy();
    expect(screen.getByText("Pizza (ambiguous name: multiple menu items)")).toBeTruthy();
    expect(t.api.importUnits).toHaveBeenCalledWith(csv.csv);
  });

  it("is the sales import for someone without menu:manage", async () => {
    signIn(["menu:read"]);
    searchParams.current = { kind: "units" };
    await makeMenu({ items, canSeeCost: false });
    render(<MenuImport />);
    expect(screen.getByText("Import sales")).toBeTruthy();
  });
});
