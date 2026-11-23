import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Adding items to a draft transfer when the book quantity is hidden.
 *
 * Without inventory:cost the server leaves `currentQty` out of the item list. Hidden is not zero: the item must
 * be offered. A holder of inventory:cost is still not offered an item at zero.
 */

let mockItems: Record<string, unknown>[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useTransfers: () => ({
    transfers: [{
      transferId: "t-1", fromLocationId: "loc-1", toLocationId: "loc-2", fromLocationName: "Main", toLocationName: "Annex",
      status: "INITIATED", lineCount: 0, createdDttm: "2026-04-10T00:00:00.000Z",
    }],
    pendingIncoming: [],
    isLoading: false,
    confirmSent: vi.fn(),
    cancel: vi.fn(),
    refresh: vi.fn(),
  }),
  useLocationIngredients: () => ({ items: mockItems, isLoading: false, refresh: vi.fn() }),
}));
vi.mock("./TransferForm.js", () => ({ default: () => null }));
vi.mock("./TransferReceiving.js", () => ({ default: () => null }));

const { default: TransferList } = await import("./TransferList.js");

const item = (over: Record<string, unknown>) => ({ ingredientCategory: "dry_goods", baseUnit: "kg", activeInd: true, ...over });

async function openAddItems() {
  render(<TransferList focusTransferId="t-1" />);
  fireEvent.click(await screen.findByRole("button", { name: /add more items/i }));
}

describe("TransferList, adding items to a draft", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ transferId: "t-1", lines: [] }) })) as unknown as typeof fetch;
  });

  it("offers an item whose quantity the server left out (no inventory:cost), with a dash", async () => {
    mockItems = [item({ ingredientId: "ing-1", ingredientName: "Flour" })];
    await openAddItems();

    expect(screen.getByRole("button", { name: /Flour/ }).textContent).toContain("— kg");
  });

  it("still leaves out an item a holder of inventory:cost sees at zero, and shows the quantity of one in stock", async () => {
    mockItems = [
      item({ ingredientId: "ing-1", ingredientName: "Flour", currentQty: "0" }),
      item({ ingredientId: "ing-2", ingredientName: "Sugar", currentQty: "4" }),
    ];
    await openAddItems();

    expect(screen.queryByRole("button", { name: /Flour/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Sugar/ }).textContent).toContain("4.0 kg");
  });
});
