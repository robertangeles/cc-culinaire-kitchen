import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The stock column of an opened purchase order.
 *
 * Without inventory:cost the server leaves `currentQty` out of the item list. Hidden is not zero: the line shows
 * a dash, not "0.0". A holder of inventory:cost still sees the quantity.
 */

let mockItems: object[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));
vi.mock("../../hooks/useInventory.js", () => ({
  usePurchaseOrders: () => ({
    pos: [{ poId: "po-1", poNumber: "PO-1", status: "DRAFT", supplierName: "Mill", lineCount: 1, createdDttm: "2026-04-10T00:00:00.000Z", totalValue: null }],
    isLoading: false,
    refresh: vi.fn(),
    getDetail: async () => ({
      poId: "po-1", poNumber: "PO-1", status: "DRAFT",
      lines: [{ lineId: "l-1", ingredientId: "ing-1", ingredientName: "Flour", orderedQty: "5", orderedUnit: "kg", receivedQty: null, unitCost: null, actualUnitCost: null, lineStatus: "PENDING" }],
    }),
  }),
  useLocationIngredients: () => ({ items: mockItems }),
}));
vi.mock("./PurchaseOrderForm.js", () => ({ default: () => null }));
vi.mock("../purchasing/ReceivingChecklist.js", () => ({ default: () => null }));

const { default: PurchaseOrderList } = await import("./PurchaseOrderList.js");

/** The cells of the opened order's Flour line: item, unit, stock, par, ... */
async function flourCells() {
  render(<PurchaseOrderList />);
  fireEvent.click(screen.getByText("PO-1"));
  const row = (await screen.findByText("Flour")).closest("tr")!;
  return [...row.querySelectorAll("td")].map((td) => td.textContent);
}

describe("PurchaseOrderList, line stock", () => {
  it("shows a dash when the server left the quantity out (no inventory:cost)", async () => {
    mockItems = [{ ingredientId: "ing-1", parLevel: "12" }];
    expect((await flourCells()).slice(2, 4)).toEqual(["—", "12.0"]);
  });

  it("shows the quantity to a holder of inventory:cost", async () => {
    mockItems = [{ ingredientId: "ing-1", parLevel: "12", currentQty: "3" }];
    expect((await flourCells()).slice(2, 4)).toEqual(["3.0", "12.0"]);
  });
});
