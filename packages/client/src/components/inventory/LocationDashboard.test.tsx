import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocationDashboard } from "./LocationDashboard.js";
import type { DashboardData, LocationIngredient } from "../../hooks/useInventory.js";

// The stock figures come from the server's dashboard (stockSummary), so the web and the phone agree.
let dashboard: DashboardData;
let items: Partial<LocationIngredient>[];
let orgLocations: object[];
vi.mock("../../hooks/useInventory.js", () => ({
  useDashboard: (id: string | null) => ({ data: id ? dashboard : null, isLoading: false }),
  useOrgDashboard: () => ({ locations: orgLocations, isLoading: false }),
  useLocationIngredients: (id: string | null) => ({ items: id ? items : [] }),
}));
vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ isOrgAdmin: orgLocations.length > 0, locations: orgLocations }),
}));
vi.mock("./ForecastCard.js", () => ({ default: () => null }));

const item = (ingredientId: string, ingredientCategory: string, currentQty: string, parLevel: string) =>
  ({ ingredientId, ingredientName: ingredientId, ingredientCategory, currentQty, parLevel, locationUnitCost: "100", orgUnitCost: null }) as Partial<LocationIngredient>;

describe("LocationDashboard", () => {
  beforeEach(() => {
    orgLocations = [];
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

  it("shows a dash, not zero, for a quantity the server leaves out (no inventory:cost)", () => {
    items = [{ ingredientId: "flour", ingredientName: "flour", ingredientCategory: "dry_goods", baseUnit: "kg", parLevel: "10" }];
    render(<LocationDashboard locationId="loc-1" />);
    fireEvent.click(screen.getByText("Critical — Reorder Now"));
    expect(screen.getByText("— kg / par 10")).toBeTruthy();
  });

  describe("drill-down into a location (HQ)", () => {
    const openDrillDown = () => {
      orgLocations = [
        { storeLocationId: "loc-1", locationName: "Main", totalItems: 2, lowStock: 1, critical: 1, lastCountDttm: null },
        { storeLocationId: "loc-2", locationName: "Annex", totalItems: 0, lowStock: 0, critical: 0, lastCountDttm: null },
      ];
      render(<LocationDashboard locationId="loc-1" />);
      fireEvent.click(screen.getByRole("button", { name: /Main/ }));
    };

    it("lists low and critical from the server's figures, not from the item rows", () => {
      // By the rows alone flour (10 of par 10) is healthy; the server says it is critical.
      openDrillDown();
      expect(screen.getByText("Critical").parentElement?.textContent).toContain("flour10.0 / par 10");
      expect(screen.getByText("Low Stock").parentElement?.textContent).toContain("cola24.0 / par 40");
    });

    it("still lists them, with a dash for the quantity, when the server leaves quantities out (no inventory:cost)", () => {
      items = [
        { ingredientId: "flour", ingredientName: "flour", ingredientCategory: "dry_goods", baseUnit: "kg", parLevel: "10" },
        { ingredientId: "cola", ingredientName: "cola", ingredientCategory: "beverages", baseUnit: "each", parLevel: "40" },
      ];
      delete dashboard.stockSummary.stockValue;
      openDrillDown();
      expect(screen.getByText("Critical").parentElement?.textContent).toContain("flour— / par 10");
      expect(screen.getByText("Low Stock").parentElement?.textContent).toContain("cola— / par 40");
    });
  });
});
