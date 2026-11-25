import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { MenuItemList } from "./MenuItemList.js";
import { MenuItemDetail } from "./MenuItemDetail.js";
import { useMenuItems, type MenuItem, type MenuIngredient } from "../../hooks/useMenuItems.js";

/**
 * Menu items belong to the organisation: every member sees them, the creator or an organisation admin changes them.
 * The server marks each row with `canManage`; these tests are the cook looking at the chef's dish.
 */
function dish(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    menuItemId: "dish-1",
    userId: 7,
    name: "Chef's risotto",
    category: "mains",
    sellingPrice: 24,
    servings: 1,
    servingsPerSale: 1,
    qFactorPct: 0,
    foodCost: 6,
    foodCostPct: 25,
    contributionMargin: 18,
    unitsSold: 10,
    menuMixPct: 50,
    classification: "star",
    periodStart: null,
    periodEnd: null,
    ...overrides,
  };
}

const renderList = (item: MenuItem, onDelete: (id: string) => Promise<void> = async () => {}) =>
  render(
    <MemoryRouter>
      <MenuItemList items={[item]} loading={false} categoryTargets={{}} onAdd={() => {}} onEdit={() => {}} onDelete={onDelete} onSelect={() => {}} />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("MenuItemList: who may change a dish", () => {
  it("shows the cook the chef's dish without edit or delete", () => {
    renderList(dish({ canManage: false }));
    expect(screen.getByText("Chef's risotto")).toBeInTheDocument();
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("shows edit and delete to someone who may manage it, and when an older server sends no flag", () => {
    const { unmount } = renderList(dish({ canManage: true }));
    expect(screen.getByTitle("Edit")).toBeInTheDocument();
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
    unmount();
    renderList(dish());
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("shows the server's reason when a delete is refused", async () => {
    renderList(dish({ canManage: true }), async () => {
      throw new Error("This menu item has recorded sales or prep history and cannot be deleted");
    });
    fireEvent.click(screen.getByTitle("Delete"));
    expect(await screen.findByRole("alert")).toHaveTextContent("recorded sales or prep history");
  });
});

describe("MenuItemDetail: who may change a recipe", () => {
  const line: MenuIngredient = { id: 1, menuItemId: "dish-1", ingredientName: "Arborio rice", quantity: "100", unit: "g", unitCost: "0.01", yieldPct: "100", lineCost: "1.00" };
  const renderDetail = (item: MenuItem, onRemoveIngredient: () => Promise<void> = async () => {}) =>
    render(
      <MemoryRouter>
        <MenuItemDetail item={item} onClose={() => {}} onAddIngredient={async () => {}} onRemoveIngredient={onRemoveIngredient} getIngredients={async () => [line]} />
      </MemoryRouter>,
    );

  it("shows the cook the chef's recipe lines without remove or add", async () => {
    renderDetail(dish({ canManage: false }));
    expect(await screen.findByText("Arborio rice")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove ingredient")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ingredient")).not.toBeInTheDocument();
  });

  it("lets a manager remove a line, and shows the server's reason when it is refused", async () => {
    renderDetail(dish({ canManage: true }), async () => {
      throw new Error("Only the person who created this menu item or an organisation admin can change it");
    });
    fireEvent.click(await screen.findByTitle("Remove ingredient"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the person who created this menu item");
    expect(screen.getByPlaceholderText("Ingredient")).toBeInTheDocument();
  });
});

describe("useMenuItems: a refused change is not swallowed", () => {
  const refuse = (status: number, error: string) =>
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method && init.method !== "GET"
        ? new Response(JSON.stringify({ error, code: "FORBIDDEN" }), { status })
        : new Response("[]", { status: 200 })));

  it("delete, update and remove-ingredient reject with the server's message", async () => {
    refuse(403, "Only the person who created this menu item or an organisation admin can change it");
    const { result } = renderHook(() => useMenuItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.deleteItem("dish-1")).rejects.toThrow("Only the person who created");
      await expect(result.current.updateItem("dish-1", { name: "x" })).rejects.toThrow("Only the person who created");
      await expect(result.current.removeIngredient("dish-1", 1)).rejects.toThrow("Only the person who created");
    });
  });
});
