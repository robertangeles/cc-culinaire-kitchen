import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Owner's rule: menu food cost, margin, line costs and on-hand stock are for holders of `inventory:cost`. The server
 * leaves the fields out for anyone else; the page must then show the rest of the menu, with no zero, NaN or empty
 * chart standing in for a figure, and a recipe edit must not throw away the costs the person cannot see.
 */

let permissions: string[] = [];
vi.mock("../context/AuthContext.js", () => ({ useAuth: () => ({ user: { userId: 1, roles: [], permissions }, isGuest: false }) }));
vi.mock("../context/LocationContext.js", () => ({ useLocation: () => ({ selectedLocationId: "loc-1" }) }));

const { MenuIntelligencePage } = await import("./MenuIntelligencePage.js");

const dish = (menuItemId: string, name: string, over: object = {}) => ({
  menuItemId, userId: 1, canManage: true, name, category: "Mains", sellingPrice: "24.00", servings: 1, servingsPerSale: 1, qFactorPct: "0.00",
  foodCost: "6.10", foodCostPct: "25.42", contributionMargin: "17.90", unitsSold: 12, menuMixPct: "60.00", classification: "star", periodStart: null, periodEnd: null, ...over,
});
const DISHES = [dish("m1", "Risotto"), dish("m2", "Gnocchi", { sellingPrice: "20.00", foodCost: "9.30", foodCostPct: "46.50", contributionMargin: "10.70", unitsSold: 8, menuMixPct: "40.00", classification: "dog" })];
const line = (id: number, ingredientName: string, over: object = {}) => ({
  id, menuItemId: "m1", ingredientId: null, ingredientName, note: null, quantity: "0.100", unit: "kg", unitCost: "4.0000", yieldPct: "100.00", lineCost: "0.40",
  costStaleInd: false, baseUnit: null, catalogUnitCost: null, ...over,
});
const LINES = [line(1, "Rice"), line(2, "Butter"), line(3, "Saffron", { ingredientId: "i3", baseUnit: "kg", costStaleInd: true, catalogUnitCost: "900.0000", unitCost: "850.0000" })];
const SALE = { saleId: "s1", depleted: [{ ingredientId: "i3", ingredientName: "Saffron", baseQty: 0.1, baseUnit: "kg", fohOnHand: 2, oversold: false }], skipped: [], oversold: [] };

const omit = (row: object, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
const num = (d: Record<string, unknown>) => ({ ...d, ...Object.fromEntries(["sellingPrice", "foodCost", "foodCostPct", "contributionMargin", "menuMixPct"].map((k) => [k, Number(d[k])])) });
const ITEM_COSTS = ["foodCost", "foodCostPct", "contributionMargin"];

/** Every write the page made, in order. */
let writes: Array<{ method: string; path: string; body: any }> = [];

/** The menu routes as the server answers them to a holder of `inventory:cost`, or to anyone else. */
function serve(seesCosts: boolean) {
  permissions = ["menu:read", "menu:manage", ...(seesCosts ? ["inventory:cost"] : [])];
  const see = (row: object, ...keys: string[]) => (seesCosts ? row : omit(row, ...keys));
  const analysis = {
    ...see({ totalItems: 2, stars: 1, plowhorses: 0, puzzles: 0, dogs: 1, unclassified: 0, totalRevenue: "448.00", avgFoodCostPct: "36.0", avgContributionMargin: "14.30", totalFoodCost: "147.60", overallFoodCostPct: "32.9" },
      "avgFoodCostPct", "avgContributionMargin", "totalFoodCost", "overallFoodCostPct"),
    items: DISHES.map((d) => see(num(d), ...ITEM_COSTS)),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (method !== "GET") {
      writes.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (path.endsWith("/sales")) return json({ ...SALE, depleted: SALE.depleted.map((d) => see(d, "fohOnHand")) });
      return json({ menuItemId: "m1" });
    }
    if (path.includes("/api/menu/analysis")) return json(analysis);
    if (path.includes("/ingredients") && path.includes("/api/menu/items/")) return json(LINES.map((l) => see(l, "unitCost", "lineCost", "catalogUnitCost")));
    if (path.includes("/api/menu/items")) return json(DISHES.map((d) => see(d, ...ITEM_COSTS)));
    if (path.includes("/api/menu/categories")) return json([{ categoryName: "Mains", targetFoodCostPct: "30.00" }]);
    if (path.includes("/conversions")) return json({ conversions: [] });
    return json([]);
  }));
}

const open = async () => {
  const { container } = render(<MemoryRouter><MenuIntelligencePage /></MemoryRouter>);
  await screen.findByText("Total Items Analyzed");
  return container;
};
const tab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
/** Every dollar or percent figure on screen, an element's own text at a time. */
const figures = (el: HTMLElement) =>
  [...el.querySelectorAll("*")].flatMap((e) => [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").match(/\d[\d.]*%|\$[\d.]+/g) ?? []);
const noStandIn = (el: HTMLElement) => expect(el.textContent).not.toMatch(/NaN|undefined|null|\$0|(?<![\d.])0\.0%/);

beforeEach(() => { writes = []; });
afterEach(() => vi.unstubAllGlobals());

describe("Menu & Costing without inventory:cost", () => {
  beforeEach(() => serve(false));

  it("dashboard: class counts and popularity, no cost card, no margin card, and a note", async () => {
    const page = await open();
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
    for (const hidden of ["Avg Food Cost", "Avg Contribution Margin", "Overall Food Cost", "Highest Margin", "Lowest Margin"]) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(screen.getByText(/costs and margins are hidden/i)).toBeInTheDocument();
    expect(figures(page)).toEqual(["60.0%", "40.0%"]);
    noStandIn(page);
  });

  it("menu items: name, price, sales and class; no cost, percentage or margin column", async () => {
    const page = await open();
    tab("Menu Items");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent!.trim())).toEqual(["Name", "Category", "Price", "Units Sold", "Class", ""]);
    expect(within(screen.getByText("Risotto").closest("tr")!).getAllByRole("cell").slice(0, 5).map((c) => c.textContent)).toEqual(["Risotto", "Mains", "$24.00", "12", "Star"]);
    expect(figures(page)).toEqual(["$20.00", "$24.00"]);
    noStandIn(page);
  });

  it("matrix: a note instead of an empty chart", async () => {
    const page = await open();
    tab("Engineering Matrix");
    expect(screen.getByText(/costs and margins are hidden/i)).toBeInTheDocument();
    expect(screen.queryByText("Menu Engineering Matrix")).not.toBeInTheDocument();
    expect(screen.queryByText("Not enough data")).not.toBeInTheDocument();
    expect(figures(page)).toEqual([]);
  });

  it("category settings: the target, no actual and nothing flagged", async () => {
    const page = await open();
    tab("Category Settings");
    expect(await screen.findByDisplayValue("30.00")).toBeInTheDocument();
    expect(screen.queryByText("Actual:")).not.toBeInTheDocument();
    expect(screen.getByText(/costs and margins are hidden/i)).toBeInTheDocument();
    expect(figures(page)).toEqual([]);
    noStandIn(page);
  });

  it("recording a sale says what was used, not what is left", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Record sale" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Record sale" }).at(-1)!);
    expect((await screen.findByText(/^Saffron/)).textContent).toBe("Saffron: −0.1 kg");
  });

  const edit = async (name: string) => {
    const page = await open();
    tab("Menu Items");
    fireEvent.click(within(screen.getByText(name).closest("tr")!).getByTitle("Edit"));
    await screen.findByDisplayValue("24.00");
    await screen.findByText("Saffron");
    return page;
  };

  it("the form has no cost column, no line cost, no cost summary and no refresh; price, quantity and yield stay", async () => {
    const page = await edit("Risotto");
    for (const hidden of ["Cost", "Line Cost", "Cost Summary", "Contribution Margin", "Batch Cost"]) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-stale-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-refresh-btn")).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue("0.100")).toHaveLength(3);
    expect(screen.getByText(/costs and margins are hidden/i)).toBeInTheDocument();
    noStandIn(page);
  });

  it("saving leaves untouched lines alone, adds a changed line before its old version goes, and sends no cost", async () => {
    await edit("Risotto");
    fireEvent.change(screen.getAllByDisplayValue("0.100")[0], { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Item" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Item" })).not.toBeInTheDocument());

    expect(writes.filter((w) => w.path.includes("/ingredients")).map((w) => [w.method, w.path.replace(/^.*\/api/, "/api"), w.body])).toEqual([
      ["POST", "/api/menu/items/m1/ingredients", { ingredientId: null, ingredientName: "Rice", note: null, quantity: "0.25", unit: "kg", yieldPct: "100" }],
      ["DELETE", "/api/menu/items/m1/ingredients/1", undefined],
    ]);
  });

  it("saving with nothing changed touches no line", async () => {
    await edit("Risotto");
    fireEvent.click(screen.getByRole("button", { name: "Update Item" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Item" })).not.toBeInTheDocument());
    expect(writes.filter((w) => w.path.includes("/ingredients"))).toEqual([]);
  });

  it("an edit opened with the key but answered without costs (a token from before it was granted) is saved the same careful way", async () => {
    permissions = ["menu:read", "menu:manage", "inventory:cost"];
    await edit("Risotto");
    expect(screen.queryByText("Cost Summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update Item" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Item" })).not.toBeInTheDocument());
    expect(writes.filter((w) => w.path.includes("/ingredients"))).toEqual([]);
  });

  it("a new item has no cost fields either", async () => {
    await open();
    tab("Menu Items");
    fireEvent.click(screen.getByRole("button", { name: "Add Menu Item" }));
    fireEvent.click(screen.getByRole("button", { name: "Create from Scratch" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Ingredient" }));
    expect(screen.queryByText("Line Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Cost Summary")).not.toBeInTheDocument();
  });
});

describe("Menu & Costing with inventory:cost", () => {
  beforeEach(() => serve(true));

  it("still shows every figure", async () => {
    const page = await open();
    expect(screen.queryByText(/costs and margins are hidden/i)).not.toBeInTheDocument();
    expect(figures(page)).toEqual(expect.arrayContaining(["36.0%", "$14.30", "32.9%", "$17.90", "$10.70"]));
    tab("Menu Items");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent!.trim())).toEqual(["Name", "Category", "Price", "Food Cost", "FC %", "CM", "Units Sold", "Class", ""]);
    expect(figures(page)).toEqual(expect.arrayContaining(["$6.10", "25.4%", "$17.90"]));
    tab("Engineering Matrix");
    expect(screen.getByText("Menu Engineering Matrix")).toBeInTheDocument();
    tab("Category Settings");
    expect(await screen.findByText("Actual:")).toBeInTheDocument();
  });

  it("the form shows costs and saves every line with its cost, as before", async () => {
    await open();
    tab("Menu Items");
    fireEvent.click(within(screen.getByText("Risotto").closest("tr")!).getByTitle("Edit"));
    expect(await screen.findByText("Cost Summary")).toBeInTheDocument();
    await screen.findByText("Saffron");
    fireEvent.click(screen.getByRole("button", { name: "Update Item" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update Item" })).not.toBeInTheDocument());
    const lines = writes.filter((w) => w.path.includes("/ingredients"));
    expect(lines.map((w) => w.method)).toEqual(["DELETE", "DELETE", "DELETE", "POST", "POST", "POST"]);
    expect(lines.slice(3).map((w) => w.body.unitCost)).toEqual(["4.0000", "4.0000", "850.0000"]);
  });

  it("a recorded sale says what is left", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Record sale" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Record sale" }).at(-1)!);
    expect((await screen.findByText(/^Saffron/)).textContent).toBe("Saffron: −0.1 kg (on hand 2)");
  });
});
