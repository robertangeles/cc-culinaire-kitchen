// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";
import { makeMenu, menuItem, menuLine, recorded } from "./menuHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/menu/MenuProvider", async () => {
  const { menu } = await import("./menuHarness");
  return {
    useMenu: () => {
      const snap = useSyncExternalStore(menu.store.subscribe, menu.store.getSnapshot);
      return { store: menu.store, api: menu.api, recents: menu.recents, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});

import MenuHome from "../app/(app)/(menu)/index";
import MenuItemScreen from "../app/(app)/(menu)/menu-item/[menuItemId]";
import MenuEdit from "../app/(app)/(menu)/menu-edit";
import MenuSale from "../app/(app)/(menu)/menu-sale";
import MenuSales from "../app/(app)/(menu)/menu-sales";
import MenuCategories from "../app/(app)/(menu)/menu-categories";

const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const signIn = (permissions: string[]) => (sessionState.current = { state: { phase: "ready", user: { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions }, location: main, locations: [main] }, busy: false });
const MANAGER = ["menu:read", "menu:manage", "inventory:cost", "inventory:count"];

beforeEach(() => {
  vi.restoreAllMocks();
  signIn(MANAGER);
  searchParams.current = {};
});

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
/** Lets a button that was disabled while something was sent take presses again: react-native-web re-arms it in an effect. */
const settle = () => act(async () => {});
const choose = (text: "Delete" | "Void") => vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === text)?.onPress?.());

describe("the menu list", () => {
  const items = [menuItem(), menuItem({ menuItemId: "m2", name: "Affogato", category: "Desserts", sellingPrice: 12, foodCost: 2, foodCostPct: 16.67, contributionMargin: 10, classification: "dog" })];

  it("shows each item's price, stored cost, margin, percentage and class to a cost holder, marks one over its target and opens it", async () => {
    await makeMenu({ items, targets: { Pasta: 20 } });
    render(<MenuHome />);
    press("Margherita, Pasta, $24.00, food cost $6.10, 25.4%, margin $17.90, over the 20% target, Star");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: "m1" } });
    expect(screen.getByText("25.4%, over 20%")).toBeTruthy();
    expect(screen.getByText("Cost $2.00 · Margin $10.00")).toBeTruthy();
  });

  it("shows someone without inventory:cost the price and the class, and no cost figure at all", async () => {
    signIn(["menu:read"]);
    await makeMenu({ items, targets: { Pasta: 20 }, canSeeCost: false });
    render(<MenuHome />);
    expect(screen.getByRole("button", { name: "Margherita, Pasta, $24.00, Star" })).toBeTruthy();
    expect(screen.queryByText(/Cost|Margin|%/)).toBeNull();
  });

  it("offers adding an item only with menu:manage, and recording a sale to everyone who reads the menu", async () => {
    await makeMenu({ items });
    const { unmount } = render(<MenuHome />);
    press("Add a menu item");
    expect(routerMock.push).toHaveBeenCalledWith("/menu-edit");
    unmount();
    signIn(["menu:read", "inventory:cost"]);
    render(<MenuHome />);
    expect(screen.queryByRole("button", { name: "Add a menu item" })).toBeNull();
    press("Record a sale");
    expect(routerMock.push).toHaveBeenCalledWith("/menu-sale");
  });

  it("narrows by search, category and class, and says when nothing matches", async () => {
    await makeMenu({ items });
    render(<MenuHome />);
    fireEvent.click(screen.getByRole("radio", { name: "Desserts" }));
    expect(screen.queryByText("Margherita")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Star" }));
    expect(screen.getByText("Nothing matches")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Desserts" }));
    expect(screen.getByText("Margherita")).toBeTruthy();
    type("Search the menu", "affo");
    expect(screen.getByText("Nothing matches")).toBeTruthy();
  });

  it("forgets a category filter whose last item is gone: there is no chip left to clear it", async () => {
    const t = await makeMenu({ items });
    render(<MenuHome />);
    fireEvent.click(screen.getByRole("radio", { name: "Desserts" }));
    t.api.items.mockResolvedValue([items[0]]);
    await act(() => t.store.refresh());
    expect(screen.getByText("Margherita")).toBeTruthy();
  });

  it("says an empty menu in a card, an error in the server's words, and with no signal shows the last menu and that writes need a connection", async () => {
    await makeMenu({ items: [] });
    const first = render(<MenuHome />);
    expect(screen.getByText("No menu items yet")).toBeTruthy();
    first.unmount();

    const t = await makeMenu({ items });
    t.api.items.mockRejectedValue(new ApiError("network"));
    await t.store.refresh();
    const second = render(<MenuHome />);
    expect(screen.getByText(/^You're offline\. This is the menu from .* need a connection\.$/)).toBeTruthy();
    expect(screen.getByText("Margherita")).toBeTruthy();
    second.unmount();

    const none = await makeMenu({ api: { items: vi.fn(async () => { throw new ApiError("forbidden", "No access", 403); }) } });
    render(<MenuHome />);
    expect(screen.getByText("No access")).toBeTruthy();
    press("Try again");
    await waitFor(() => expect(none.api.items).toHaveBeenCalledTimes(2));
  });

  it("is laid out in the tablet column", async () => {
    await makeMenu({ items });
    render(<MenuHome />);
    const column = screen.getByText("Menu").parentElement?.parentElement as HTMLElement;
    expect(parseFloat(getComputedStyle(column).maxWidth)).toBe(560);
  });
});

describe("a menu item", () => {
  beforeEach(() => void (searchParams.current = { menuItemId: "m1" }));

  it("shows the stored figures, the set-up, the allergens and the lines with the cost per kitchen unit", async () => {
    await makeMenu({ lines: [menuLine({ unit: "g", quantity: 120, yieldPct: 95 })], targets: { Pasta: 20 } });
    render(<MenuItemScreen />);
    expect(await screen.findByText("120 g · 95% yield · $14.00 per kg")).toBeTruthy();
    for (const label of ["Selling price, $24.00", "Food cost per sale, $6.10", "Food cost, 25.4%", "Contribution margin, $17.90", "Price covers, 1 serving", "Units sold, 12"]) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText("Over the 20% target for Pasta.")).toBeTruthy();
    expect(screen.getByText("Dairy")).toBeTruthy();
    press("Record a sale");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/menu-sale", params: { menuItemId: "m1" } });
  });

  it("shows no cost without inventory:cost: no figure, no line cost, no stale-cost note", async () => {
    signIn(["menu:read", "menu:manage"]);
    await makeMenu({ canSeeCost: false, lines: [menuLine({ costStaleInd: true })] });
    render(<MenuItemScreen />);
    expect(await screen.findByText("0.12 kg")).toBeTruthy();
    expect(screen.queryByText(/6\.10|17\.90|25\.4|1\.68|14\.00|cost/i)).toBeNull();
    expect(screen.getByLabelText("Selling price, $24.00")).toBeTruthy();
  });

  it("hides change and delete without menu:manage, and for an item someone else made", async () => {
    signIn(["menu:read", "inventory:cost"]);
    await makeMenu();
    const { unmount } = render(<MenuItemScreen />);
    expect(screen.queryByRole("button", { name: "Change the item" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete the item" })).toBeNull();
    unmount();
    signIn(MANAGER);
    await makeMenu({ items: [menuItem({ canManage: false })] });
    render(<MenuItemScreen />);
    expect(screen.queryByRole("button", { name: "Change the item" })).toBeNull();
    await screen.findByText("Mozzarella");
  });

  it("deletes after asking, and stays with the server's words when the item has sales", async () => {
    const t = await makeMenu({ api: { remove: vi.fn(async () => { throw new ApiError("conflict", "This menu item has recorded sales", 409, undefined, "CONFLICT"); }) } });
    choose("Delete");
    render(<MenuItemScreen />);
    press("Delete the item");
    expect(await screen.findByText("This menu item has recorded sales")).toBeTruthy();
    expect(routerMock.back).not.toHaveBeenCalled();
    t.api.remove.mockResolvedValueOnce(undefined as never);
    await settle();
    press("Delete the item");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
  });

  it("refreshes a line's stale cost, and says when that needs a connection", async () => {
    const t = await makeMenu({ lines: [menuLine({ costStaleInd: true })] });
    render(<MenuItemScreen />);
    t.api.refreshCost.mockRejectedValueOnce(new ApiError("network"));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh the cost of Mozzarella" }));
    expect(await screen.findByText(/needs a connection/)).toBeTruthy();
    await settle();
    press("Refresh the cost of Mozzarella");
    await waitFor(() => expect(t.api.refreshCost).toHaveBeenCalledTimes(2));
  });
});

describe("adding a menu item", () => {
  it("previews the cost with the shared editor figures, links a picked ingredient and saves item and line", async () => {
    const t = await makeMenu({ items: [] });
    render(<MenuEdit />);
    await waitFor(() => expect(t.api.catalogue).toHaveBeenCalled());
    type("Item name", "Focaccia");
    fireEvent.click(screen.getByRole("radio", { name: "Sides" }));
    type("Selling price, in $", "8");
    press("Add an ingredient");
    type("Ingredient", "flo");
    fireEvent.click(await screen.findByRole("button", { name: "Use Flour" }));
    type("How much Flour", "0,5");
    expect(await screen.findByLabelText("Batch cost, $1.00, the sum of 1 line")).toBeTruthy();
    expect(screen.getByLabelText("Food cost, 12.5%")).toBeTruthy();
    expect(screen.getByLabelText("Contribution margin, $7.00")).toBeTruthy();
    press("Save the item");
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/menu-item/[menuItemId]", params: { menuItemId: "m9" } }));
    expect(t.api.create).toHaveBeenCalledWith({ name: "Focaccia", category: "Sides", sellingPrice: "8.00", servings: 1, servingsPerSale: 1, qFactorPct: "0" });
    expect(t.api.addLine).toHaveBeenCalledWith("m9", { ingredientId: "i2", ingredientName: "Flour", note: null, quantity: "0.5", unit: "kg", yieldPct: "100", unitCost: "2" });
  });

  it("says what is missing before sending anything, and does not offer units sold, which the server's create does not take", async () => {
    const t = await makeMenu({ items: [] });
    render(<MenuEdit />);
    press("Save the item");
    expect(screen.getByText(/Give the item a name/)).toBeTruthy();
    expect(t.api.create).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Units sold")).toBeNull();
  });

  it("hides every cost field without inventory:cost", async () => {
    signIn(["menu:read", "menu:manage"]);
    await makeMenu({ items: [], canSeeCost: false });
    render(<MenuEdit />);
    press("Add an ingredient");
    expect(screen.queryByLabelText(/^Cost per/)).toBeNull();
    expect(screen.queryByText("Cost summary")).toBeNull();
  });

  it("starts from a saved recipe", async () => {
    await makeMenu({ items: [], recipes: [{ recipeId: "r1", title: "Gnocchi", domain: "recipe", yield: "4", ingredients: [{ name: "Potato", amount: "500", unit: "g", note: null }] }] });
    render(<MenuEdit />);
    press("Start from a recipe");
    fireEvent.click(await screen.findByRole("button", { name: "Start from Gnocchi" }));
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("Gnocchi");
    expect((screen.getByLabelText("Servings the recipe makes") as HTMLInputElement).value).toBe("4");
    expect(screen.getByRole("button", { name: /^Potato, 500 g/ })).toBeTruthy();
  });

  it("with no signal says nothing is saved yet and that Save again adds nothing twice", async () => {
    const t = await makeMenu({ items: [] });
    render(<MenuEdit />);
    type("Item name", "Focaccia");
    fireEvent.click(screen.getByRole("radio", { name: "Sides" }));
    type("Selling price, in $", "8");
    t.api.items.mockRejectedValueOnce(new ApiError("network"));
    press("Save the item");
    expect(await screen.findByText("The server can't be reached, so this may not be saved. Press Save again: nothing is added twice.")).toBeTruthy();
    expect(t.api.create).not.toHaveBeenCalled();
    await settle();
    press("Save the item");
    await waitFor(() => expect(t.api.create).toHaveBeenCalledTimes(1));
  });

  it("is refused to someone without menu:manage", async () => {
    signIn(["menu:read", "inventory:cost"]);
    await makeMenu();
    render(<MenuEdit />);
    expect(screen.getByText(/Ask a manager/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save the item" })).toBeNull();
  });
});

describe("changing a menu item", () => {
  beforeEach(() => void (searchParams.current = { menuItemId: "m1" }));

  it("sends only the changed price and goes back to the item", async () => {
    const t = await makeMenu();
    render(<MenuEdit />);
    fireEvent.change(await screen.findByLabelText("Selling price, in $"), { target: { value: "26" } });
    press("Save the item");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(t.api.update).toHaveBeenCalledWith("m1", { sellingPrice: "26.00" });
    expect(t.api.addLine).not.toHaveBeenCalled();
    expect(t.api.removeLine).not.toHaveBeenCalled();
  });

  it("replaces a changed line", async () => {
    const t = await makeMenu();
    render(<MenuEdit />);
    fireEvent.click(await screen.findByRole("button", { name: /^Mozzarella, 0.12 kg/ }));
    type("How much Mozzarella", "0.2");
    press("Save the item");
    await waitFor(() => expect(t.api.removeLine).toHaveBeenCalledWith("m1", 1));
    expect(t.api.addLine).toHaveBeenCalledWith("m1", expect.objectContaining({ ingredientName: "Mozzarella", quantity: "0.2", unitCost: "14" }));
  });

  it("says when a line's unit cannot become the kitchen unit, and swaps the linked item for a typed one at no carried-over cost", async () => {
    const t = await makeMenu({ lines: [menuLine({ unit: "bunch" })] });
    render(<MenuEdit />);
    expect(await screen.findByText("bunch cannot become kg, the unit Mozzarella is kept in. Choose another unit.")).toBeTruthy();
    press(/^Mozzarella, 0.12 bunch/);
    press("Swap Mozzarella");
    type("Ingredient", "Burrata");
    expect(screen.queryByText(/cannot become/)).toBeNull();
    press("Save the item");
    await waitFor(() => expect(t.api.addLine).toHaveBeenCalledWith("m1", { ingredientId: null, ingredientName: "Burrata", note: null, quantity: "0.12", unit: "bunch", yieldPct: "100" }));
  });

  it("needs a connection to open, and is refused for an item someone else made", async () => {
    const t = await makeMenu({ api: { lines: vi.fn(async () => { throw new ApiError("network"); }) } });
    const { unmount } = render(<MenuEdit />);
    expect(await screen.findByText(/Changing the menu needs a connection/)).toBeTruthy();
    await settle();
    press("Try again");
    await waitFor(() => expect(t.api.lines).toHaveBeenCalledTimes(2));
    unmount();
    await makeMenu({ items: [menuItem({ canManage: false })] });
    render(<MenuEdit />);
    expect(await screen.findByText(/Only the person who made this item/)).toBeTruthy();
  });
});

describe("recording a sale", () => {
  it("sells the item it was opened for, at this location, and shows what came off stock", async () => {
    searchParams.current = { menuItemId: "m1" };
    const t = await makeMenu();
    render(<MenuSale />);
    type("How many", "2");
    press("Record the sale");
    expect(await screen.findByText("Sale recorded")).toBeTruthy();
    expect(t.api.sell).toHaveBeenCalledWith({ key: "key1", target: { kind: "dish", id: "m1", name: "Margherita" }, qty: 2, locationId: "L1" });
    expect(screen.getByText("Mozzarella: −0.24 kg (on hand 3)")).toBeTruthy();
    expect(screen.getByText(/not linked to the catalogue: Basil/)).toBeTruthy();
    press("Record another");
    expect(screen.getByLabelText("What was sold")).toBeTruthy();
  });

  it("hides what is left on hand without inventory:cost", async () => {
    signIn(["menu:read"]);
    searchParams.current = { menuItemId: "m1" };
    await makeMenu({ canSeeCost: false });
    render(<MenuSale />);
    press("Record the sale");
    expect(await screen.findByText("Mozzarella: −0.24 kg")).toBeTruthy();
  });

  it("offers front-of-house items sold as they are, found by name", async () => {
    const t = await makeMenu({ consumables: [{ ingredientId: "c1", ingredientName: "Cola can", baseUnit: "each" }] });
    render(<MenuSale />);
    press("Record the sale");
    expect(screen.getByText("Pick what was sold.")).toBeTruthy();
    type("What was sold", "cola");
    press("Sell Cola can");
    press("Record the sale");
    await waitFor(() => expect(t.api.sell).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: "consumable", id: "c1", name: "Cola can" } })));
    await screen.findByText("Sale recorded");
  });

  it("after no answer, keeps the sale and sends the same one again", async () => {
    searchParams.current = { menuItemId: "m1" };
    const t = await makeMenu();
    t.api.sell.mockRejectedValueOnce(new ApiError("network"));
    render(<MenuSale />);
    press("Record the sale");
    expect(await screen.findByText("This sale is not confirmed")).toBeTruthy();
    expect(screen.getByText(/^The server can't be reached\. It may or may not be recorded/)).toBeTruthy();
    t.api.sell.mockResolvedValueOnce({ ...recorded, alreadyExists: true, depleted: [] });
    press("Send it again");
    expect(await screen.findByText(/It was not recorded twice/)).toBeTruthy();
    expect(t.api.sell.mock.calls[0]).toEqual(t.api.sell.mock.calls[1]);
  });

  it("shows the server's refusal on the form, which stays open", async () => {
    searchParams.current = { menuItemId: "m1" };
    const t = await makeMenu();
    t.api.sell.mockRejectedValueOnce(new ApiError("bad_request", "Cannot convert ml to kg", 422, undefined, "INCOMPATIBLE_UNITS"));
    render(<MenuSale />);
    press("Record the sale");
    expect(await screen.findByText("Cannot convert ml to kg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record the sale" })).toBeTruthy();
    await settle();
    type("How many", "0");
    press("Record the sale");
    expect(await screen.findByText(/Enter how many were sold/)).toBeTruthy();
  });
});

describe("recent sales", () => {
  const sales = [
    { saleId: "s1", menuItemName: "Margherita", qtySold: 2, soldAt: "2026-11-25T01:00:00.000Z", voidedAt: null, canManage: true },
    { saleId: "s2", menuItemName: "Affogato", qtySold: 1, soldAt: "2026-11-25T00:00:00.000Z", voidedAt: "2026-11-25T00:30:00.000Z", canManage: true },
    { saleId: "s3", menuItemName: "Tiramisu", qtySold: 1, soldAt: "2026-11-24T00:00:00.000Z", voidedAt: null, canManage: false },
  ];

  it("lists them and voids one after asking, offered only where the server allows it", async () => {
    const t = await makeMenu({ sales });
    choose("Void");
    render(<MenuSales />);
    expect(await screen.findByText("2 × Margherita")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Void" })).toHaveLength(1);
    expect(screen.getByText("Voided")).toBeTruthy();
    press("Void");
    await waitFor(() => expect(t.api.voidSale).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(t.api.sales).toHaveBeenCalledTimes(2));
  });

  it("offers no void without menu:manage, says an empty list in a card, and that the list needs a connection", async () => {
    signIn(["menu:read"]);
    await makeMenu({ sales });
    const first = render(<MenuSales />);
    await screen.findByText("2 × Margherita");
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
    first.unmount();
    await makeMenu();
    const second = render(<MenuSales />);
    expect(await screen.findByText("No sales yet")).toBeTruthy();
    second.unmount();
    await makeMenu({ api: { sales: vi.fn(async () => { throw new ApiError("network"); }) } });
    render(<MenuSales />);
    expect(await screen.findByText("Recent sales show when you're back online.")).toBeTruthy();
  });
});

describe("category targets", () => {
  const items = [menuItem(), menuItem({ menuItemId: "m2", name: "Carbonara", foodCostPct: 40 })];

  it("shows each category's target, actual and items over it, and saves a changed target", async () => {
    const t = await makeMenu({ items });
    render(<MenuCategories />);
    expect(screen.getByText("32.7%")).toBeTruthy();
    press("1 over 30%, show");
    expect(screen.getByText("Carbonara")).toBeTruthy();
    type("Target for Pasta, in %", "45");
    press("Save the target for Pasta");
    expect(await screen.findByText("Saved.")).toBeTruthy();
    expect(t.api.setTarget).toHaveBeenCalledWith("Pasta", "45");
    expect(screen.queryByText("1 over 30%, show")).toBeNull();
    await settle();
    type("Target for Pasta, in %", "120");
    press("Save the target for Pasta");
    expect(await screen.findByText(/up to 100 percent/)).toBeTruthy();
  });

  it("only shows the target without menu:manage, and no actual without inventory:cost", async () => {
    signIn(["menu:read"]);
    await makeMenu({ items, canSeeCost: false, targets: { Pasta: 28 } });
    render(<MenuCategories />);
    expect(screen.getByText("28%")).toBeTruthy();
    expect(screen.queryByText("Actual")).toBeNull();
    expect(screen.queryByLabelText(/^Target for/)).toBeNull();
    expect(screen.queryByText(/\d over/)).toBeNull();
  });
});
