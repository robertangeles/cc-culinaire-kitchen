import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationDashboard } from "./LocationDashboard.js";
import type { DashboardData, LocationIngredient } from "../../hooks/useInventory.js";

// The stock figures come from the server's dashboard (stockSummary), so the web and the phone agree.
let dashboard: DashboardData;
let items: Partial<LocationIngredient>[];
vi.mock("../../hooks/useInventory.js", () => ({
  useDashboard: (id: string | null) => ({ data: id ? dashboard : null, isLoading: false }),
  useOrgDashboard: () => ({ locations: [], isLoading: false }),
  useLocationIngredients: (id: string | null) => ({ items: id ? items : [] }),
}));
vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ isOrgAdmin: false, locations: [] }),
}));
vi.mock("./ForecastCard.js", () => ({ default: () => null }));

const item = (ingredientId: string, ingredientCategory: string, currentQty: string, parLevel: string) =>
  ({ ingredientId, ingredientName: ingredientId, ingredientCategory, currentQty, parLevel, locationUnitCost: "100", orgUnitCost: null }) as Partial<LocationIngredient>;

describe("LocationDashboard", () => {
  beforeEach(() => {
    // The item rows alone would say flour is healthy and worth $1,000: the page must show the server's figures instead.
    items = [item("flour", "dry_goods", "10", "10"), item("cola", "beverages", "24", "40")];
    dashboard = {
      stockLevels: [],
      activeSession: null,
      lastCompletedSession: null,
      stockSummary: {
        lowCount: 1,
        criticalCount: 1,
        lowIngredientIds: ["cola"],
        criticalIngredientIds: ["flour"],
        stockValue: 75,
        valueByCategory: [{ category: "dry_goods", value: 30 }, { category: "beverages", value: 45 }],
      },
    };
  });

  it("shows the server's low, critical and value figures", () => {
    render(<LocationDashboard locationId="loc-1" />);
    expect(screen.getByText("Critical — Reorder Now").parentElement?.textContent).toContain("1 items");
    expect(screen.getByText("Low Stock — Monitor").parentElement?.textContent).toContain("1 items");
    expect(screen.getByText("$75")).toBeTruthy();
  });

  it("shows no value when the server leaves it out (no inventory:cost)", () => {
    delete dashboard.stockSummary.stockValue;
    delete dashboard.stockSummary.valueByCategory;
    render(<LocationDashboard locationId="loc-1" />);
    expect(screen.queryByText("Value by Category")).toBeNull();
    expect(screen.getByText("Critical — Reorder Now")).toBeTruthy();
  });
});
