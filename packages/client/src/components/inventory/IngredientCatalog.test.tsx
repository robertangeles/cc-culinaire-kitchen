import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Ingredient } from "../../hooks/useInventory.js";

/**
 * Saving an ingredient whose cost the server left out.
 *
 * Without inventory:cost the catalogue list carries no `unitCost`. Editing such an item (a rename) must not
 * write an empty cost over the stored one; a price the user types is still saved.
 */

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));
let mockIngredients: Ingredient[] = [];
let mockLocItems: object[] = [];
vi.mock("../../hooks/useInventory.js", () => ({
  useIngredients: () => ({ ingredients: mockIngredients, isLoading: false }),
  useSuppliers: () => ({ suppliers: [] }),
  useLocationIngredients: () => ({ items: mockLocItems }),
  useIngredientStock: () => ({ levels: [] }),
  useIngredientSuppliers: () => ({ suppliers: [], assign: vi.fn(), updateLink: vi.fn(), removeLink: vi.fn() }),
}));
vi.mock("./TransactionHistory.js", () => ({ TransactionHistory: () => null }));

const { EditIngredientModal, IngredientCatalog } = await import("./IngredientCatalog.js");

const flour = (over: Partial<Ingredient> = {}) =>
  ({
    ingredientId: "ing-1", ingredientName: "Flour", ingredientCategory: "dry_goods", itemType: "KITCHEN_INGREDIENT", baseUnit: "kg",
    contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null, description: null, parLevel: null,
    ...over,
  }) as Ingredient;

async function save(ingredient: Ingredient, before: () => void = () => {}) {
  const onSave = vi.fn(async (_data: Partial<Ingredient>) => {});
  render(<EditIngredientModal ingredient={ingredient} onSave={onSave} onDelete={vi.fn()} onCheckUsage={vi.fn(async () => [])} onClose={vi.fn()} />);
  before();
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0];
}

describe("EditIngredientModal, unit cost on save", () => {
  it("leaves unitCost out when the server did not send it and no price was typed", async () => {
    const sent = await save(flour(), () => fireEvent.change(screen.getByDisplayValue("Flour"), { target: { value: "Bread flour" } }));

    expect(sent.ingredientName).toBe("Bread flour");
    expect(sent).not.toHaveProperty("unitCost");
  });

  it("saves a price typed for an ingredient that arrived without one", async () => {
    const sent = await save(flour(), () => fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "3.5" } }));

    expect(sent.unitCost).toBe("3.5");
  });

  it("keeps sending the stored cost for a holder of inventory:cost", async () => {
    expect((await save(flour({ unitCost: "2.5000" }))).unitCost).toBe("2.5000");
  });

  it("still clears a cost a holder of inventory:cost deletes", async () => {
    const sent = await save(flour({ unitCost: "2.5000" }), () => fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "" } }));

    expect(sent.unitCost).toBeNull();
  });
});

describe("IngredientCatalog, stock status", () => {
  const showCritical = () => {
    render(<IngredientCatalog />);
    const category = screen.getByRole("button", { name: /Dry Goods/i });
    fireEvent.click(category);
    const flagged = category.querySelectorAll(".bg-red-400").length;
    fireEvent.change(screen.getByDisplayValue("All Status"), { target: { value: "critical" } });
    return flagged;
  };

  it("gives an item no status when the server left its quantity out (no inventory:cost)", () => {
    mockIngredients = [flour()];
    mockLocItems = [{ ingredientId: "ing-1", parLevel: "10" }];

    expect(showCritical()).toBe(0);
    expect(screen.queryByText("Flour")).toBeNull();
  });

  it("still marks an item critical for a holder of inventory:cost who sees it at zero", () => {
    mockIngredients = [flour()];
    mockLocItems = [{ ingredientId: "ing-1", parLevel: "10", currentQty: "0" }];

    expect(showCritical()).toBe(1);
    expect(screen.getByText("Flour")).toBeTruthy();
  });
});
