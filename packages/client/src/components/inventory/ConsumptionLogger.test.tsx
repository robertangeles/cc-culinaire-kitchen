import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The "that's a move, not usage" guardrail.
 *
 * Background: stock carried to the bar is still sellable — it leaves the site
 * only when it sells or is wasted. Logging it as FOH usage deducts it once now
 * and again at the sale (double-deduction), and shows the difference as phantom
 * yield variance. The intercept catches that entry before it is written.
 *
 * The line the tests defend: it must fire for sellable stock (KITCHEN_INGREDIENT,
 * FOH_CONSUMABLE) and must NOT fire for OPERATIONAL_SUPPLY — napkins taken to
 * the floor genuinely are consumed, so FOH usage is right for them.
 */

const logConsumption = vi.fn(async () => ({}));

function item(overrides: Record<string, unknown> = {}) {
  return {
    ingredientId: "ing-1",
    ingredientName: "Shiraz",
    ingredientCategory: "spirits",
    itemType: "KITCHEN_INGREDIENT",
    baseUnit: "bottle",
    unitOverride: null,
    activeInd: true,
    currentQty: "24",
    ...overrides,
  };
}

let mockItems: ReturnType<typeof item>[] = [item()];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useMenuItems.js", () => ({
  useMenuItems: () => ({ items: [] }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useLocationIngredients: () => ({
    items: mockItems,
    isLoading: false,
    refresh: vi.fn(),
  }),
  useConsumptionLog: () => ({
    logs: [],
    isLoading: false,
    logConsumption,
    editLog: vi.fn(),
    deleteLog: vi.fn(),
  }),
}));

const { default: ConsumptionLogger } = await import("./ConsumptionLogger.js");

/** Walk the operator flow: pick a reason, filter to the item, select it, enter qty. */
async function fillEntry(reasonLabel: string, itemName: string, qty = "4") {
  fireEvent.click(screen.getByRole("button", { name: reasonLabel }));

  const filter = screen.getByPlaceholderText("Filter items...");
  fireEvent.change(filter, { target: { value: itemName } });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(itemName) }));

  const qtyInput = await screen.findByPlaceholderText("0.0");
  fireEvent.change(qtyInput, { target: { value: qty } });
}

/** The submit button reads "Transfer" (or "Logging..." mid-flight). */
function submit() {
  fireEvent.click(screen.getByRole("button", { name: /^transfer$/i }));
}

describe("ConsumptionLogger — move-not-usage guardrail", () => {
  beforeEach(() => {
    mockItems = [item()];
    logConsumption.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("intercepts FOH usage of a sellable kitchen ingredient", async () => {
    render(<ConsumptionLogger />);
    await fillEntry("FOH", "Shiraz");

    submit();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/that's a move, not usage/i)).toBeInTheDocument();
    // The whole point: nothing was written.
    expect(logConsumption).not.toHaveBeenCalled();
  });

  it("intercepts FOH usage of an FOH consumable", async () => {
    mockItems = [item({ itemType: "FOH_CONSUMABLE", ingredientName: "San Pellegrino" })];
    render(<ConsumptionLogger />);
    await fillEntry("FOH", "San Pellegrino");

    submit();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(logConsumption).not.toHaveBeenCalled();
  });

  it("does NOT intercept FOH usage of an operational supply — napkins really are consumed", async () => {
    mockItems = [item({ itemType: "OPERATIONAL_SUPPLY", ingredientName: "Napkins", baseUnit: "each" })];
    render(<ConsumptionLogger />);
    await fillEntry("FOH", "Napkins");

    submit();

    await waitFor(() => expect(logConsumption).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does NOT intercept a non-FOH reason on sellable stock", async () => {
    render(<ConsumptionLogger />);
    await fillEntry("Kitchen", "Shiraz");

    submit();

    await waitFor(() => expect(logConsumption).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("'Log as usage anyway' is a real escape hatch — staff comps still get logged", async () => {
    render(<ConsumptionLogger />);
    await fillEntry("FOH", "Shiraz");
    submit();
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /log as usage anyway/i }));

    await waitFor(() => expect(logConsumption).toHaveBeenCalledTimes(1));
    expect(logConsumption).toHaveBeenCalledWith(
      expect.objectContaining({ ingredientId: "ing-1", reason: "foh_operations", quantity: 4 }),
    );
  });

  it("'Go back' dismisses without writing anything", async () => {
    render(<ConsumptionLogger />);
    await fillEntry("FOH", "Shiraz");
    submit();
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /go back/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(logConsumption).not.toHaveBeenCalled();
  });
});
