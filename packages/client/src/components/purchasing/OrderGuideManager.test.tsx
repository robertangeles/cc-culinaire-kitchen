import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Order guide authoring.
 *
 * Without this screen the guide-first ordering flow has nothing to read — the PO
 * form only consumes guides. What matters: the guide gets created against the
 * right supplier, and the row order the operator arranges (their shelf-to-sheet
 * walk) is the order that gets saved. The server replaces the set wholesale, so a
 * dropped or reordered row is a real bug.
 */

const createGuide = vi.fn(async (_d: any) => ({ orderGuideId: "g-new" }));
const deleteGuide = vi.fn(async (_id: string) => {});
const saveItems = vi.fn(async (_items: any[]) => {});

let mockGuides: any[] = [];
let mockItems: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useSuppliers: () => ({
    suppliers: [{ supplierId: "sup-1", supplierName: "PFD Food Services" }],
    isLoading: false,
    refresh: vi.fn(),
  }),
  useLocationIngredients: () => ({
    items: [
      { ingredientId: "ing-3", ingredientName: "Olive Oil", baseUnit: "L" },
    ],
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../hooks/useOrderGuides.js", () => ({
  useOrderGuides: () => ({
    guides: mockGuides,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGuide,
    updateGuide: vi.fn(),
    deleteGuide,
  }),
  useOrderGuideItems: () => ({
    items: mockItems,
    loading: false,
    error: null,
    refresh: vi.fn(),
    saveItems,
  }),
}));

const { default: OrderGuideManager } = await import("./OrderGuideManager.js");

const GUIDE = {
  orderGuideId: "g-1",
  name: "Weekly Dry Goods",
  supplierId: "sup-1",
  supplierName: "PFD Food Services",
  storeLocationId: "loc-1",
  sortOrder: 0,
  activeInd: true,
  updatedDttm: "2026-07-20T00:00:00.000Z",
  itemCount: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGuides = [];
  mockItems = [];
});

describe("OrderGuideManager", () => {
  it("invites the operator to build their first guide", () => {
    render(<OrderGuideManager />);
    expect(screen.getByText("No order guides yet")).toBeTruthy();
  });

  it("creates a guide against the chosen supplier", async () => {
    render(<OrderGuideManager />);

    fireEvent.change(screen.getByPlaceholderText(/Guide name/), {
      target: { value: "Weekly Dry Goods" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "sup-1" } });
    fireEvent.click(screen.getByText("Create guide"));

    await waitFor(() => expect(createGuide).toHaveBeenCalled());
    expect(createGuide.mock.calls[0][0]).toEqual({
      supplierId: "sup-1",
      name: "Weekly Dry Goods",
    });
  });

  it("won't create a guide without a supplier", async () => {
    render(<OrderGuideManager />);
    fireEvent.change(screen.getByPlaceholderText(/Guide name/), { target: { value: "No supplier" } });
    fireEvent.click(screen.getByText("Create guide"));

    expect(await screen.findByText("Pick a supplier")).toBeTruthy();
    expect(createGuide).not.toHaveBeenCalled();
  });

  it("saves the walk order the operator arranged", async () => {
    mockGuides = [GUIDE];
    mockItems = [
      { ingredientId: "ing-1", ingredientName: "Flour" },
      { ingredientId: "ing-2", ingredientName: "Sugar" },
    ];
    render(<OrderGuideManager />);

    // Open the guide's item editor.
    fireEvent.click(screen.getByText("Weekly Dry Goods"));
    expect(await screen.findByText("Flour")).toBeTruthy();

    // Sugar should be walked first — move it up.
    fireEvent.click(screen.getByLabelText("Move Sugar up"));
    fireEvent.click(screen.getByText("Save items"));

    await waitFor(() => expect(saveItems).toHaveBeenCalled());
    expect(saveItems.mock.calls[0][0]).toEqual([
      { ingredientId: "ing-2", sortOrder: 0 },
      { ingredientId: "ing-1", sortOrder: 1 },
    ]);
  });

  it("drops a removed row from the saved set", async () => {
    mockGuides = [GUIDE];
    mockItems = [
      { ingredientId: "ing-1", ingredientName: "Flour" },
      { ingredientId: "ing-2", ingredientName: "Sugar" },
    ];
    render(<OrderGuideManager />);

    fireEvent.click(screen.getByText("Weekly Dry Goods"));
    fireEvent.click(await screen.findByLabelText("Remove Flour"));
    fireEvent.click(screen.getByText("Save items"));

    await waitFor(() => expect(saveItems).toHaveBeenCalled());
    expect(saveItems.mock.calls[0][0]).toEqual([{ ingredientId: "ing-2", sortOrder: 0 }]);
  });
});
