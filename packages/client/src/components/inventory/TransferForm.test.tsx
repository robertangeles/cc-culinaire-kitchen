import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Building a transfer when the book quantity is hidden.
 *
 * Without inventory:cost the server leaves `currentQty` out of the item list. Hidden is not zero: the item must
 * stay pickable and the transfer must go out. A holder of inventory:cost still cannot pick an item at zero.
 */

const initiate = vi.fn(async (_input: unknown) => ({ transferId: "t-1" }));
let mockItems: Record<string, unknown>[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({
    selectedLocationId: "loc-1",
    selectedLocation: { storeLocationId: "loc-1", locationName: "Main" },
    locations: [
      { storeLocationId: "loc-1", locationName: "Main", classification: "branch" },
      { storeLocationId: "loc-2", locationName: "Annex", classification: "branch" },
    ],
  }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useLocationIngredients: (id: string | null) => ({ items: id === "loc-1" ? mockItems : [], isLoading: false, refresh: vi.fn() }),
  useTransfers: () => ({ initiate, confirmSent: vi.fn(), cancel: vi.fn() }),
}));

const { default: TransferForm } = await import("./TransferForm.js");

const flour = (over: Record<string, unknown> = {}) => ({
  ingredientId: "ing-1",
  ingredientName: "Flour",
  ingredientCategory: "dry_goods",
  baseUnit: "kg",
  unitOverride: null,
  activeInd: true,
  ...over,
});

const openPicker = () => fireEvent.click(screen.getByRole("button", { name: /add items/i }));

describe("TransferForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets an item be added and sent when the server left its quantity out (no inventory:cost)", async () => {
    mockItems = [flour()];
    render(<TransferForm onClose={vi.fn()} />);
    openPicker();
    const row = screen.getByRole("button", { name: /Flour/ });
    expect(row.hasAttribute("disabled")).toBe(false);
    expect(row.textContent).toContain("— kg");

    fireEvent.click(row);

    expect(screen.getByText("— kg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /select destination/i }));
    fireEvent.click(screen.getByRole("button", { name: /Annex/ }));
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /initiate transfer/i }));
    await waitFor(() => expect(initiate).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(initiate.mock.calls[0][0])).toContain("ing-1");
  });

  it("still blocks an item a holder of inventory:cost sees at zero", () => {
    mockItems = [flour({ currentQty: "0" })];
    render(<TransferForm onClose={vi.fn()} />);
    openPicker();

    const row = screen.getByRole("button", { name: /Flour/ });
    expect(row.hasAttribute("disabled")).toBe(true);
    expect(row.textContent).toContain("Out of stock");
  });
});
