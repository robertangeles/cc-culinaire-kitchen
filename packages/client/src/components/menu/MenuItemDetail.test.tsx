import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MenuItem } from "../../hooks/useMenuItems.js";

/**
 * The server answers a failed recommendation with 503 AI_UNAVAILABLE or 504 AI_TIMEOUT instead of canned text,
 * so the panel has to say so: a chef who asks during a model outage must not be left with a spinner that just stops.
 */

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

const { MenuItemDetail } = await import("./MenuItemDetail.js");

const item: MenuItem = {
  menuItemId: "item-1",
  userId: 1,
  name: "Charred Leeks",
  category: "Starters",
  sellingPrice: 18,
  servings: 1,
  servingsPerSale: 1,
  qFactorPct: 0,
  foodCost: 4,
  foodCostPct: 22,
  contributionMargin: 14,
  unitsSold: 40,
  menuMixPct: 10,
  classification: "star",
  periodStart: null,
  periodEnd: null,
};

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function ask() {
  render(
    <MenuItemDetail item={item} onClose={vi.fn()} onAddIngredient={vi.fn()} onRemoveIngredient={vi.fn()} getIngredients={async () => []} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /get recommendations/i }));
}

describe("MenuItemDetail — recommendations that fail", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says it took too long when the server answers 504 AI_TIMEOUT", async () => {
    fetchMock.mockResolvedValue(answer(504, { error: "That took too long. Please try again.", code: "AI_TIMEOUT" }));
    ask();

    expect(await screen.findByRole("alert")).toHaveTextContent("That took too long. Please try again.");
  });

  it.each([
    ["the server answers 503 AI_UNAVAILABLE", () => fetchMock.mockResolvedValue(answer(503, { error: "x", code: "AI_UNAVAILABLE" }))],
    ["the answer is an error page, not JSON", () => fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("not json"); } })],
    ["the network is down", () => fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))],
  ])("says recommendations are unavailable when %s", async (_name, arrange) => {
    arrange();
    ask();

    expect(await screen.findByRole("alert")).toHaveTextContent("Recommendations are unavailable right now. Please try again shortly.");
  });

  it("clears the message and shows the recommendations when the next try works", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, { error: "x", code: "AI_UNAVAILABLE" }));
    ask();
    await screen.findByRole("alert");

    fetchMock.mockResolvedValueOnce(answer(200, { summary: "Protect this dish.", actions: [] }));
    fireEvent.click(screen.getByRole("button", { name: /get recommendations/i }));

    expect(await screen.findByText("Protect this dish.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("MenuItemDetail without inventory:cost (the server leaves costs out)", () => {
  const { foodCost: _c, foodCostPct: _p, contributionMargin: _m, ...hidden } = item;
  const line = { id: 1, menuItemId: "item-1", ingredientName: "Leeks", quantity: "0.300", unit: "kg", yieldPct: "100" };

  it("shows the price and the recipe, a note, and no figure standing in for a cost", async () => {
    const { container } = render(
      <MenuItemDetail item={hidden} onClose={vi.fn()} onAddIngredient={vi.fn()} onRemoveIngredient={vi.fn()} getIngredients={async () => [line]} />,
    );
    expect(await screen.findByText("0.300 kg")).toBeInTheDocument();
    expect(screen.getByText("$18.00")).toBeInTheDocument();
    expect(screen.getByText(/costs and margins are hidden/i)).toBeInTheDocument();
    for (const label of ["Food Cost", "CM"]) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(container.textContent!.match(/\$[\d.]*/g)).toEqual(["$18.00"]);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });

  it("adds an ingredient without asking for a cost", async () => {
    const onAddIngredient = vi.fn(async () => {});
    render(<MenuItemDetail item={hidden} onClose={vi.fn()} onAddIngredient={onAddIngredient} onRemoveIngredient={vi.fn()} getIngredients={async () => [line]} />);
    fireEvent.change(await screen.findByPlaceholderText("Ingredient"), { target: { value: "Butter" } });
    expect(screen.queryByPlaceholderText("$/unit")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "0.05" } });
    fireEvent.submit(screen.getByPlaceholderText("Qty").closest("form")!);
    await waitFor(() => expect(onAddIngredient).toHaveBeenCalledWith("item-1", { ingredientName: "Butter", quantity: "0.05", unit: "kg", unitCost: undefined, yieldPct: "100" }));
  });

  it("still asks a holder for the cost", async () => {
    const onAddIngredient = vi.fn(async () => {});
    render(<MenuItemDetail item={item} onClose={vi.fn()} onAddIngredient={onAddIngredient} onRemoveIngredient={vi.fn()} getIngredients={async () => []} />);
    fireEvent.change(await screen.findByPlaceholderText("Ingredient"), { target: { value: "Butter" } });
    fireEvent.change(screen.getByPlaceholderText("Qty"), { target: { value: "0.05" } });
    fireEvent.submit(screen.getByPlaceholderText("Qty").closest("form")!);
    expect(onAddIngredient).not.toHaveBeenCalled();
  });
});
