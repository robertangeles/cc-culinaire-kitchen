import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The stock column of an opened purchase order.
 *
 * Without inventory:cost the server leaves `currentQty` out of the item list. Hidden is not zero: the line shows
 * a dash, not "0.0". A holder of inventory:cost still sees the quantity.
 */

let mockItems: object[] = [];
let mockStatus = "DRAFT";
const clonePO = vi.fn();

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));
// Neither test is about approving, so the viewer holds no permission.
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => () => false,
}));
vi.mock("../../hooks/useInventory.js", () => ({
  usePurchaseOrders: () => ({
    pos: [{ poId: "po-1", poNumber: "PO-1", status: mockStatus, supplierName: "Mill", lineCount: 1, createdDttm: "2026-04-10T00:00:00.000Z", totalValue: null }],
    isLoading: false,
    refresh: vi.fn(),
    clonePO,
    getDetail: async () => ({
      poId: "po-1", poNumber: "PO-1", status: mockStatus,
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
  mockStatus = "DRAFT";
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

describe("PurchaseOrderList, reorder", () => {
  const alertSpy = vi.fn();

  beforeEach(() => {
    mockStatus = "RECEIVED";
    mockItems = [];
    alertSpy.mockReset();
    clonePO.mockReset();
    vi.stubGlobal("alert", alertSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function reorder(reply: object) {
    clonePO.mockResolvedValue({ poId: "po-2", ...reply });
    render(<PurchaseOrderList />);
    fireEvent.click(screen.getByText("PO-1"));
    fireEvent.click(await screen.findByRole("button", { name: /Reorder/ }));
    await waitFor(() => expect(clonePO).toHaveBeenCalledWith("po-1", "loc-1"));
  }

  it("says which quantities to check when nothing was left out", async () => {
    await reorder({ skippedItems: [], quantityWarnings: [{ ingredientName: "Rye" }] });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith("Check the quantity of Rye: a unit could not be converted, so the last order's quantity may have been kept."));
  });

  it("says both what was left out and what to check", async () => {
    await reorder({ skippedItems: ["Salt"], quantityWarnings: [{ ingredientName: "Rye" }] });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("PO cloned. 1 item(s) skipped (at or above par level). Check the quantity of Rye: a unit could not be converted, so the last order's quantity may have been kept."),
    );
  });

  it("stays quiet when nothing was left out and every quantity was worked out", async () => {
    await reorder({ skippedItems: [] });
    await waitFor(() => expect(clonePO).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
