import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Bulk par editor — the surface that unblocks order-to-par.
 *
 * Until pars exist every suggested quantity is zero and the order guides look
 * broken, so the thing that matters here is that the operator's typed numbers
 * actually land, and that untouched rows are left alone (a stray write would
 * silently change ordering behaviour for an item they never looked at).
 */

const refresh = vi.fn(async () => {});
let mockItems: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useLocationIngredients: () => ({ items: mockItems, isLoading: false, refresh }),
}));

const { default: BulkParEditor } = await import("./BulkParEditor.js");

const item = (over: Record<string, unknown> = {}) => ({
  ingredientId: "ing-1",
  ingredientName: "Shiraz",
  baseUnit: "bottle",
  parLevel: "8",
  orgParLevel: null,
  currentQty: "3",
  ...over,
});

const WINE = item();
const FLOUR = item({
  ingredientId: "ing-2",
  ingredientName: "Baker's Flour",
  baseUnit: "g",
  parLevel: null,
  orgParLevel: null,
  currentQty: "0",
});

beforeEach(() => {
  vi.clearAllMocks();
  mockItems = [WINE, FLOUR];
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
});

describe("BulkParEditor", () => {
  it("shows how many items still need a par", () => {
    render(<BulkParEditor />);
    // Wine has a par, flour doesn't — the gap is the whole point of the screen.
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/of 2 set/)).toBeTruthy();
  });

  it("writes only the rows the operator changed", async () => {
    render(<BulkParEditor />);

    // Nothing edited yet -> nothing to save.
    const saveBtn = screen.getByText("Save pars").closest("button")!;
    expect(saveBtn.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Par level for Baker's Flour"), {
      target: { value: "25000" },
    });
    expect(saveBtn.hasAttribute("disabled")).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as any).mock.calls[0];
    // Only the flour row was touched, so only the flour row is written.
    expect(url).toContain("/locations/loc-1/ingredients/ing-2");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ parLevel: "25000" });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("ignores an edit that matches the existing par", async () => {
    render(<BulkParEditor />);

    // Retyping the same value isn't a change.
    fireEvent.change(screen.getByLabelText("Par level for Shiraz"), { target: { value: "8" } });

    const saveBtn = screen.getByText("Save pars").closest("button")!;
    expect(saveBtn.hasAttribute("disabled")).toBe(true);
  });
});
