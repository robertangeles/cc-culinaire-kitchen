import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Order-guide-first PO creation.
 *
 * The whole point of P1: the operator picks their regular list and the draft is
 * ALREADY correct — quantities at par minus what's on the shelf — instead of
 * hunting a catalog and doing the subtraction in their head. Rows already at par
 * stay visible (so they can be bumped) but must never become PO lines.
 */

const createPO = vi.fn(async () => ({ poId: "po-1" }));
const submitPO = vi.fn(async () => ({}));

let mockGuides: any[] = [];
let mockGuideItems: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useLocationIngredients: () => ({ items: [], isLoading: false, refresh: vi.fn() }),
  useSuppliers: () => ({
    suppliers: [{ supplierId: "sup-1", supplierName: "PFD Food Services" }],
    isLoading: false,
    refresh: vi.fn(),
  }),
  usePurchaseOrders: () => ({ createPO, submitPO }),
}));

vi.mock("../../hooks/useOrderGuides.js", () => ({
  useOrderGuides: () => ({
    guides: mockGuides,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGuide: vi.fn(),
    updateGuide: vi.fn(),
    deleteGuide: vi.fn(),
  }),
  useOrderGuideItems: () => ({
    items: mockGuideItems,
    loading: false,
    error: null,
    refresh: vi.fn(),
    saveItems: vi.fn(),
  }),
}));

const { default: PurchaseOrderForm } = await import("./PurchaseOrderForm.js");

const GUIDE = {
  orderGuideId: "g-1",
  name: "Weekly Wine",
  supplierId: "sup-1",
  supplierName: "PFD Food Services",
  storeLocationId: "loc-1",
  sortOrder: 0,
  activeInd: true,
  updatedDttm: "2026-07-20T00:00:00.000Z",
  itemCount: 2,
};

/** Below par: 3 on hand against a par of 8 -> order 5. */
const WINE = {
  ingredientId: "ing-wine",
  ingredientName: "Shiraz",
  baseUnit: "bottle",
  purchaseUnit: "case",
  packQty: 12,
  onHand: 3,
  parLevel: 8,
  suggestedParLevel: null,
  suggestedOrderQty: 5,
  belowPar: true,
  unitCost: 15,
  supplierMinOrderQty: 2,
  defaultOrderQty: null,
  defaultPurchaseUnit: null,
  sortOrder: 0,
};

/** Already at par: nothing to order. */
const FLOUR = {
  ingredientId: "ing-flour",
  ingredientName: "Baker's Flour",
  baseUnit: "g",
  purchaseUnit: null,
  packQty: null,
  onHand: 30000,
  parLevel: 25000,
  suggestedParLevel: null,
  suggestedOrderQty: 0,
  belowPar: false,
  unitCost: 2,
  supplierMinOrderQty: null,
  defaultOrderQty: null,
  defaultPurchaseUnit: null,
  sortOrder: 1,
};

function renderForm() {
  return render(<PurchaseOrderForm onBack={vi.fn()} onCreated={vi.fn()} />);
}

async function pickGuide() {
  fireEvent.click(screen.getByText("Weekly Wine"));
  await waitFor(() => expect(screen.getByDisplayValue("5")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGuides = [GUIDE];
  mockGuideItems = [WINE, FLOUR];
});

describe("PurchaseOrderForm — order-guide-first", () => {
  it("fills the draft to par when a guide is picked", async () => {
    renderForm();
    // Nothing pre-filled until the operator chooses their list.
    expect(screen.queryByDisplayValue("5")).toBeNull();

    await pickGuide();

    // Below-par item arrives at its shortfall, with the reasoning on screen.
    expect(screen.getByDisplayValue("5")).toBeTruthy();
    expect(screen.getByText(/On hand 3 \/ par 8/)).toBeTruthy();
    expect(screen.getByText(/below par/)).toBeTruthy();
    // At-par item is still listed, just at zero.
    expect(screen.getByDisplayValue("0")).toBeTruthy();
  });

  it("'Order everything to par' re-snaps a line the operator changed", async () => {
    renderForm();
    await pickGuide();

    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "1" } });
    expect(screen.getByDisplayValue("1")).toBeTruthy();

    fireEvent.click(screen.getByText("Order everything to par"));
    expect(screen.getByDisplayValue("5")).toBeTruthy();
  });

  it("the per-line TO PAR chip snaps just that line", async () => {
    renderForm();
    await pickGuide();

    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "2" } });
    // First chip belongs to the first line (the wine).
    fireEvent.click(screen.getAllByText("TO PAR")[0]);

    expect(screen.getByDisplayValue("5")).toBeTruthy();
  });

  it("does not submit rows that are already at par", async () => {
    renderForm();
    await pickGuide();

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => expect(createPO).toHaveBeenCalled());
    const arg = createPO.mock.calls[0][0] as any;
    expect(arg.supplierId).toBe("sup-1");
    expect(arg.lines).toHaveLength(1);
    expect(arg.lines[0].ingredientId).toBe("ing-wine");
    expect(arg.lines[0].orderedQty).toBe("5");
    // Ordered in the supplier's packaging, not the kitchen unit.
    expect(arg.lines[0].orderedUnit).toBe("case");
  });
});
