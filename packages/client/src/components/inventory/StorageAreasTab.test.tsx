import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

/**
 * Areas admin — the surface where a chef says "the bar is a place, and these
 * things live in it".
 *
 * What matters here: the sheet the operator builds is the sheet that gets
 * saved. Order is the walk order, pars are per-area and in kitchen units, and
 * the picker saves the WHOLE set (the server replaces wholesale), so a dropped
 * or reordered row is a real bug rather than cosmetics.
 */

const create = vi.fn(async () => {});
const update = vi.fn(async () => {});
const deactivate = vi.fn(async () => {});
const setItems = vi.fn(async () => {});
const getItems = vi.fn(async () => [] as any[]);

let mockAreas: any[] = [];
let mockLocationItems: any[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  useStorageAreas: () => ({
    areas: mockAreas,
    isLoading: false,
    refresh: vi.fn(),
    create,
    update,
    deactivate,
    getItems,
    setItems,
  }),
  useLocationIngredients: () => ({
    items: mockLocationItems,
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

const { default: StorageAreasTab } = await import("./StorageAreasTab.js");

const area = (over: Record<string, unknown> = {}) => ({
  storageAreaId: "area-1",
  areaName: "Bar",
  sortOrder: 0,
  activeInd: true,
  itemCount: 0,
  ...over,
});

const ing = (over: Record<string, unknown> = {}) => ({
  ingredientId: "ing-1",
  ingredientName: "Shiraz",
  baseUnit: "bottle",
  activeInd: true,
  ...over,
});

describe("StorageAreasTab", () => {
  beforeEach(() => {
    mockAreas = [];
    mockLocationItems = [ing()];
    getItems.mockResolvedValue([]);
    vi.clearAllMocks();
  });
  afterEach(() => vi.clearAllMocks());

  it("invites the first area instead of showing an empty table", () => {
    render(<StorageAreasTab />);
    expect(screen.getByText(/create your first area/i)).toBeInTheDocument();
    expect(screen.getByText(/stock room, bar, foh counter/i)).toBeInTheDocument();
  });

  it("says plainly that areas do not move stock — the thing operators fear", () => {
    render(<StorageAreasTab />);
    expect(screen.getByText(/never changes what you have/i)).toBeInTheDocument();
  });

  it("creates an area, appending it to the end of the walk", async () => {
    mockAreas = [area(), area({ storageAreaId: "area-2", areaName: "Room", sortOrder: 1 })];
    render(<StorageAreasTab />);

    fireEvent.change(screen.getByLabelText(/add a storage area/i), { target: { value: "Walk-in" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith("Walk-in", 2));
  });

  it("surfaces the server's sentence when a name is rejected", async () => {
    create.mockRejectedValueOnce(new Error('"Unassigned" is reserved — choose a different area name'));
    render(<StorageAreasTab />);

    fireEvent.change(screen.getByLabelText(/add a storage area/i), { target: { value: "Unassigned" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
  });

  it("reorders the walk by swapping sort orders", async () => {
    mockAreas = [area(), area({ storageAreaId: "area-2", areaName: "Room", sortOrder: 1 })];
    render(<StorageAreasTab />);

    fireEvent.click(screen.getByLabelText(/move Room earlier in the walk/i));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith("area-2", { sortOrder: 0 });
      expect(update).toHaveBeenCalledWith("area-1", { sortOrder: 1 });
    });
  });

  it("renames an area", async () => {
    mockAreas = [area()];
    render(<StorageAreasTab />);

    fireEvent.click(screen.getByRole("button", { name: /rename Bar/i }));
    const input = screen.getByRole("textbox", { name: /rename Bar/i });
    fireEvent.change(input, { target: { value: "Main Bar" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(update).toHaveBeenCalledWith("area-1", { areaName: "Main Bar" }));
  });

  it("removes an area (soft — history survives, which the server enforces)", async () => {
    mockAreas = [area()];
    render(<StorageAreasTab />);

    fireEvent.click(screen.getByRole("button", { name: /remove Bar/i }));

    await waitFor(() => expect(deactivate).toHaveBeenCalledWith("area-1"));
  });

  describe("item picker", () => {
    it("saves the full sheet with pars in kitchen units and walk order", async () => {
      mockAreas = [area()];
      render(<StorageAreasTab />);

      fireEvent.click(screen.getByRole("button", { name: /0 items/i }));
      const dialog = await screen.findByRole("dialog");

      fireEvent.change(within(dialog).getByPlaceholderText(/add an item/i), {
        target: { value: "Shiraz" },
      });
      fireEvent.click(await within(dialog).findByRole("button", { name: /Shiraz/ }));

      fireEvent.change(within(dialog).getByLabelText(/par level for Shiraz/i), {
        target: { value: "6" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: /save sheet/i }));

      await waitFor(() =>
        expect(setItems).toHaveBeenCalledWith("area-1", [
          { ingredientId: "ing-1", areaParLevel: 6, sortOrder: 0 },
        ]),
      );
    });

    it("a blank par saves as null, not 0 — 'no par' is not 'par of zero'", async () => {
      mockAreas = [area()];
      render(<StorageAreasTab />);

      fireEvent.click(screen.getByRole("button", { name: /0 items/i }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByPlaceholderText(/add an item/i), {
        target: { value: "Shiraz" },
      });
      fireEvent.click(await within(dialog).findByRole("button", { name: /Shiraz/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: /save sheet/i }));

      await waitFor(() =>
        expect(setItems).toHaveBeenCalledWith("area-1", [
          { ingredientId: "ing-1", areaParLevel: null, sortOrder: 0 },
        ]),
      );
    });

    it("reordering rows changes the saved walk order", async () => {
      mockAreas = [area({ itemCount: 2 })];
      mockLocationItems = [ing(), ing({ ingredientId: "ing-2", ingredientName: "Flour", baseUnit: "g" })];
      getItems.mockResolvedValue([
        { ingredientId: "ing-1", ingredientName: "Shiraz", baseUnit: "bottle", areaParLevel: null, sortOrder: 0 },
        { ingredientId: "ing-2", ingredientName: "Flour", baseUnit: "g", areaParLevel: null, sortOrder: 1 },
      ]);
      render(<StorageAreasTab />);

      fireEvent.click(screen.getByRole("button", { name: /2 items/i }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Shiraz");

      fireEvent.click(within(dialog).getByLabelText(/move Flour up/i));
      fireEvent.click(within(dialog).getByRole("button", { name: /save sheet/i }));

      await waitFor(() =>
        expect(setItems).toHaveBeenCalledWith("area-1", [
          { ingredientId: "ing-2", areaParLevel: null, sortOrder: 0 },
          { ingredientId: "ing-1", areaParLevel: null, sortOrder: 1 },
        ]),
      );
    });

    it("removing a row drops it from the saved sheet", async () => {
      mockAreas = [area({ itemCount: 2 })];
      getItems.mockResolvedValue([
        { ingredientId: "ing-1", ingredientName: "Shiraz", baseUnit: "bottle", areaParLevel: "6", sortOrder: 0 },
        { ingredientId: "ing-2", ingredientName: "Flour", baseUnit: "g", areaParLevel: null, sortOrder: 1 },
      ]);
      render(<StorageAreasTab />);

      fireEvent.click(screen.getByRole("button", { name: /2 items/i }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Shiraz");

      fireEvent.click(within(dialog).getByLabelText(/remove Shiraz/i));
      fireEvent.click(within(dialog).getByRole("button", { name: /save sheet/i }));

      await waitFor(() =>
        expect(setItems).toHaveBeenCalledWith("area-1", [
          { ingredientId: "ing-2", areaParLevel: null, sortOrder: 0 },
        ]),
      );
    });

    it("does not offer an item already on the sheet", async () => {
      mockAreas = [area({ itemCount: 1 })];
      getItems.mockResolvedValue([
        { ingredientId: "ing-1", ingredientName: "Shiraz", baseUnit: "bottle", areaParLevel: null, sortOrder: 0 },
      ]);
      render(<StorageAreasTab />);

      fireEvent.click(screen.getByRole("button", { name: /1 item/i }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Shiraz");

      fireEvent.change(within(dialog).getByPlaceholderText(/add an item/i), {
        target: { value: "Shiraz" },
      });
      // The row is present, but no add-candidate button for it.
      await waitFor(() => {
        expect(within(dialog).getAllByText("Shiraz")).toHaveLength(1);
      });
    });
  });
});
