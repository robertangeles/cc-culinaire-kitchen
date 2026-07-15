import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { LocationIngredient } from "../../hooks/useInventory.js";

/**
 * The movement form — the sanctioned way to say "I carried 4 bottles to the bar".
 *
 * The property that matters: recording a move must never read as a stock
 * change, in the copy or in the call. The form posts to /stock-movements and
 * nothing else; the server proves the zero-stock-effect invariant, and this
 * suite proves the operator is told so plainly.
 */

const recordMovement = vi.fn(async () => {});

let mockAreas: any[] = [];
let mockItems: any[] = [];
let mockMovements: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useStorageAreas: () => ({ areas: mockAreas, isLoading: false, refresh: vi.fn() }),
  useStockMovements: () => ({
    movements: mockMovements,
    isLoading: false,
    refresh: vi.fn(),
    recordMovement,
  }),
  useLocationIngredients: () => ({ items: mockItems, isLoading: false, refresh: vi.fn() }),
}));

const { default: StockMovementForm } = await import("./StockMovementForm.js");

const area = (id: string, name: string) => ({
  storageAreaId: id,
  areaName: name,
  sortOrder: 0,
  activeInd: true,
  itemCount: 0,
});

/** Only the fields this form reads; cast because LocationIngredient has ~26 more. */
const wine = {
  ingredientId: "ing-1",
  ingredientName: "Shiraz",
  baseUnit: "bottle",
  unitOverride: null,
  activeInd: true,
  currentQty: "24",
} as unknown as LocationIngredient;

async function pickItem(name = "Shiraz") {
  fireEvent.change(screen.getByPlaceholderText(/search items/i), { target: { value: name } });
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
}

describe("StockMovementForm", () => {
  beforeEach(() => {
    mockAreas = [area("a-room", "Stock Room"), area("a-bar", "Bar")];
    mockItems = [wine];
    mockMovements = [];
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it("records a move with the item, amount, and both areas", async () => {
    render(<StockMovementForm />);
    await pickItem();

    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "a-room" } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "a-bar" } });
    fireEvent.click(screen.getByRole("button", { name: /record move/i }));

    await waitFor(() =>
      expect(recordMovement).toHaveBeenCalledWith({
        ingredientId: "ing-1",
        fromStorageAreaId: "a-room",
        toStorageAreaId: "a-bar",
        quantity: 4,
        unit: "bottle",
        notes: undefined,
      }),
    );
  });

  it("tells the operator their stock is untouched — before and after", async () => {
    render(<StockMovementForm />);
    await pickItem();
    expect(screen.getByText(/doesn't change your stock/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "a-room" } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "a-bar" } });
    fireEvent.click(screen.getByRole("button", { name: /record move/i }));

    expect(await screen.findByText(/site stock unchanged/i)).toBeInTheDocument();
  });

  it("moves in the item's kitchen unit, honouring a location override", async () => {
    mockItems = [{ ...wine, unitOverride: "case" }];
    render(<StockMovementForm />);
    await pickItem();

    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "a-room" } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "a-bar" } });
    fireEvent.click(screen.getByRole("button", { name: /record move/i }));

    await waitFor(() =>
      expect(recordMovement).toHaveBeenCalledWith(expect.objectContaining({ unit: "case" })),
    );
  });

  it("won't let you move something to where it already is", async () => {
    render(<StockMovementForm />);
    await pickItem();
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "a-bar" } });

    // The chosen 'from' is absent from the 'to' list, so from === to is unreachable.
    const to = screen.getByLabelText(/^to$/i) as HTMLSelectElement;
    const options = Array.from(to.options).map((o) => o.value);
    expect(options).not.toContain("a-bar");
    expect(options).toContain("a-room");
  });

  it("surfaces the server's sentence when a move is rejected", async () => {
    recordMovement.mockRejectedValueOnce(new Error("That area is no longer in use"));
    render(<StockMovementForm />);
    await pickItem();

    fireEvent.change(screen.getByLabelText(/how much/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: "a-room" } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: "a-bar" } });
    fireEvent.click(screen.getByRole("button", { name: /record move/i }));

    expect(await screen.findByText(/no longer in use/i)).toBeInTheDocument();
  });

  it("points you at Areas instead of a broken form when none exist", () => {
    mockAreas = [];
    render(<StockMovementForm />);
    expect(screen.getByText(/no areas yet/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search items/i)).not.toBeInTheDocument();
  });

  it("a single area can't host a move — says so rather than offering a dead form", () => {
    mockAreas = [area("a-bar", "Bar")];
    render(<StockMovementForm />);
    expect(screen.getByText(/need a second area/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search items/i)).not.toBeInTheDocument();
  });

  describe("arriving from the guardrail", () => {
    it("carries the item and amount over so nothing is retyped", async () => {
      render(<StockMovementForm prefill={{ item: wine, quantity: 4 }} />);

      expect(await screen.findByText("Shiraz")).toBeInTheDocument();
      expect(screen.getByLabelText(/how much/i)).toHaveValue(4);
      // Straight to the only thing still unanswered: where did it go?
      expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
    });

    it("a prefill without an amount still lands on the item, ready for the qty", async () => {
      render(<StockMovementForm prefill={{ item: wine }} />);
      expect(await screen.findByText("Shiraz")).toBeInTheDocument();
      expect(screen.getByLabelText(/how much/i)).toHaveValue(null);
    });

    it("no prefill means the normal blank form", async () => {
      render(<StockMovementForm />);
      expect(await screen.findByPlaceholderText(/search items/i)).toBeInTheDocument();
      expect(screen.queryByText("Shiraz")).not.toBeInTheDocument();
    });
  });

  it("shows recent moves as a plain sentence: what, from where, to where", () => {
    mockMovements = [
      {
        stockMovementId: "m-1",
        ingredientId: "ing-1",
        ingredientName: "Shiraz",
        quantity: "4.000",
        unit: "bottle",
        fromAreaName: "Stock Room",
        toAreaName: "Bar",
        userName: "Rob",
        notes: null,
        movedAt: new Date("2026-07-15T10:00:00Z").toISOString(),
      },
    ];
    render(<StockMovementForm />);
    expect(screen.getByText("Shiraz")).toBeInTheDocument();
    expect(screen.getByText(/Stock Room → Bar/)).toBeInTheDocument();
  });
});
