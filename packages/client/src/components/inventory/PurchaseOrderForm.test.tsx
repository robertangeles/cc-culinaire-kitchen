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

const createPO = vi.fn(async (_input: any) => ({ poId: "po-1" }));
const submitPO = vi.fn(async (_poId: string) => ({}));

let mockGuides: any[] = [];
let mockGuideItems: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

let mockIngredients: any[] = [];

vi.mock("../../hooks/useInventory.js", () => ({
  useLocationIngredients: () => ({ items: mockIngredients, isLoading: false, refresh: vi.fn() }),
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

/**
 * Below par: 6 bottles on hand against a par of 42 -> 36 bottles short.
 * Bought by the case of 12, so the ORDER is 3 cases — not 36.
 * The qty field is labelled with purchaseUnit, so filling it with the
 * kitchen-unit shortfall orders packQty times too much. This shipped as a live
 * bug: 25 kg of flour in 12.5 kg bags prefilled as "50 bag" = 625 kg.
 */
const WINE = {
  ingredientId: "ing-wine",
  ingredientName: "Shiraz",
  baseUnit: "bottle",
  purchaseUnit: "case",
  packQty: 12,
  onHand: 6,
  parLevel: 42,
  suggestedParLevel: null,
  suggestedOrderQty: 36,
  suggestedPackages: 3,
  belowPar: true,
  unitCost: 15,
  packUnitCost: 180, // $15/bottle x 12 per case
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
  suggestedPackages: null,
  belowPar: false,
  unitCost: 2,
  packUnitCost: null, // no packaging
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
  await waitFor(() => expect(screen.getByDisplayValue("3")).toBeTruthy());
}

/** A catalogue item with none of its optional data resolved — the "—" row. */
const BARE_CATALOG_ITEM = {
  ingredientId: "ing-spice",
  ingredientName: "Mixed Spice",
  baseUnit: "kg",
  currentQty: "0",
  parLevel: null,
  orgParLevel: null,
  supplierMinOrderQty: null,
  locationUnitCost: null,
  orgUnitCost: null,
  purchaseUnit: null,
  packQty: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGuides = [GUIDE];
  mockGuideItems = [WINE, FLOUR];
  mockIngredients = [];
});

describe("PurchaseOrderForm — order-guide-first", () => {
  it("fills the draft to par IN THE PURCHASE UNIT when a guide is picked", async () => {
    renderForm();
    // Nothing pre-filled until the operator chooses their list.
    expect(screen.queryByDisplayValue("3")).toBeNull();

    await pickGuide();

    // 36 bottles short, bought by the case of 12 -> 3 cases.
    expect(screen.getByDisplayValue("3")).toBeTruthy();
    // The kitchen-unit shortfall must NEVER reach the qty field: that is the
    // 12x over-order that shipped ("50 bag" of flour against a 25 kg par).
    expect(screen.queryByDisplayValue("36")).toBeNull();
    // Par context reads in the unit the chef counts in — ONCE. It used to
    // print "In stock / Par" and then "On hand / par" directly beneath it.
    expect(screen.getByText(/In stock: 6.0/)).toBeTruthy();
    expect(screen.getByText(/Par: 42.0/)).toBeTruthy();
    expect(screen.getAllByText("below par")).toHaveLength(1);
    expect(screen.queryByText(/On hand 6/)).toBeNull();
    // At-par item is still listed, just at zero.
    expect(screen.getByDisplayValue("0")).toBeTruthy();
  });

  it("'Order everything to par' re-snaps a line the operator changed", async () => {
    renderForm();
    await pickGuide();

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "7" } });
    expect(screen.getByDisplayValue("7")).toBeTruthy();

    fireEvent.click(screen.getByText("Order everything to par"));
    expect(screen.getByDisplayValue("3")).toBeTruthy();
    expect(screen.queryByDisplayValue("36")).toBeNull();
  });

  it("the per-line TO PAR chip snaps just that line", async () => {
    renderForm();
    await pickGuide();

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "7" } });
    // First chip belongs to the first line (the wine).
    fireEvent.click(screen.getAllByText("TO PAR")[0]);

    expect(screen.getByDisplayValue("3")).toBeTruthy();
    expect(screen.queryByDisplayValue("36")).toBeNull();
  });

  it("warns when a line falls under the supplier's real minimum", async () => {
    renderForm();
    await pickGuide();

    // At 3 cases we're above the supplier minimum of 2 — no warning.
    expect(screen.queryByText(/Supplier minimum is 2/)).toBeNull();

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "1" } });
    expect(screen.getByText(/Supplier minimum is 2/)).toBeTruthy();

    // Warn, don't block — the operator can still knowingly under-order.
    fireEvent.click(screen.getByText("Save as Draft"));
    await waitFor(() => expect(createPO).toHaveBeenCalled());
  });

  it("does not dump the catalogue before the operator has picked or searched", async () => {
    // The complaint that started this rework: opening a PO rendered every item
    // in the catalogue with Par / Min Ord / Unit Cost all "—", which reads as
    // "we hold no data on any of your products".
    mockIngredients = [BARE_CATALOG_ITEM];
    renderForm();

    expect(screen.queryByText("Mixed Spice")).toBeNull();
    expect(screen.queryByText("Min Ord")).toBeNull();
    // ...and it says what to do instead of showing a wall of dashes.
    expect(screen.getByText(/Pick a guide above/)).toBeTruthy();
  });

  it("shows the catalogue once the operator actually searches", async () => {
    mockIngredients = [BARE_CATALOG_ITEM];
    renderForm();

    fireEvent.change(screen.getByPlaceholderText(/Filter items by name/), {
      target: { value: "spice" },
    });

    // Debounced at 150ms.
    await waitFor(() => expect(screen.getByText("Mixed Spice")).toBeTruthy());
    expect(screen.getByText("Min Ord")).toBeTruthy();
  });

  it("submits the package qty against the package unit, and drops at-par rows", async () => {
    renderForm();
    await pickGuide();

    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => expect(createPO).toHaveBeenCalled());
    const arg = createPO.mock.calls[0][0] as any;
    expect(arg.supplierId).toBe("sup-1");
    expect(arg.lines).toHaveLength(1);
    expect(arg.lines[0].ingredientId).toBe("ing-wine");
    // Qty and unit must agree: 3 CASES. "36" here would be 36 cases = 432
    // bottles against a par of 42.
    expect(arg.lines[0].orderedQty).toBe("3");
    expect(arg.lines[0].orderedUnit).toBe("case");
  });
});
