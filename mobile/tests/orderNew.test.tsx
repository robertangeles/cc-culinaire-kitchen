// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Alert } from "react-native";
import { routerMock } from "../testing/mocks";
import { ApiError } from "../src/api/client";
import { COLUMN_WIDTH } from "../src/ui/Screen";
import { admin, api, memoryKv, ordersFor, person, resetApi } from "./ordersHarness";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { useSession: () => sessionState.current, client: {} };
});
vi.mock("../src/storage/kv", () => ({ sqliteKv: {} }));

import OrderNew from "../app/(app)/(orders)/order-new";
import Orders from "../app/(app)/(orders)/index";

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const find = (name: string | RegExp) => screen.findByRole("button", { name });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const answer = (label: string) =>
  vi.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => buttons?.find((b) => b.text === label)?.onPress?.());

async function addFlour() {
  fireEvent.click(await find("Order from Fresh Farms"));
  type("Add an item", "fl");
  fireEvent.click(await find("Use Flour"));
  await find(/^Flour, 1 bag/);
}

beforeEach(resetApi);

describe("writing an order", () => {
  it("by hand: supplier, item, quantity, then saved as a draft and opened", async () => {
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    expect((screen.getByLabelText("Price per bag") as HTMLInputElement).value).toBe("17.5");
    expect(screen.getByText("In stock 4 kg, par 25 kg, below par")).toBeTruthy();
    type("Order", "2");
    expect(screen.getAllByText("$35.00").length).toBeGreaterThan(0);
    fireEvent.click(button("Save as draft"));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/order", params: { poId: "P9" } }));
    expect(api.create).toHaveBeenCalledWith({ storeLocationId: "L1", supplierId: "s1", lines: [{ ingredientId: "i1", orderedQty: "2", orderedUnit: "bag", unitCost: "17.5" }] });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("saves and submits, and when only the submit failed opens the saved draft saying so", async () => {
    api.submit.mockRejectedValue(new ApiError("network"));
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    fireEvent.click(button("Save and submit"));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/order", params: { poId: "P9", notice: "Saved, but not submitted. Can't reach the server. Submitting an order needs a connection." } }));
  });

  it("says what is missing", async () => {
    render(<OrderNew />, ordersFor(admin));
    fireEvent.click(await find("Save as draft"));
    expect(await screen.findByText("Choose a supplier.")).toBeTruthy();
  });

  it("from a guide: every item to par with its supplier, the ones at par in sight but not ordered", async () => {
    api.guides.mockResolvedValue([{ orderGuideId: "g1", name: "Weekly dry", supplierId: "s1", supplierName: "Fresh Farms", itemCount: 1 }]);
    render(<OrderNew />, ordersFor(admin));
    fireEvent.click(await find("Use the guide Weekly dry, 1 item"));
    expect(await find(/^Flour, 2 bag, \$35\.00/)).toBeTruthy();
    expect(button("Supplier, Fresh Farms. Change")).toBeTruthy();
    fireEvent.click(button(/^Flour, 2 bag/));
    expect(screen.getByText("The supplier's minimum is 3.")).toBeTruthy();
    type("Order", "0");
    expect(await find(/^Flour, Not ordered/)).toBeTruthy();
    fireEvent.click(button("Order everything to par"));
    expect(await find(/^Flour, 2 bag/)).toBeTruthy();
  });

  it("asks before a guide replaces items already on the order", async () => {
    api.guides.mockResolvedValue([{ orderGuideId: "g1", name: "Weekly dry", supplierId: "s1", supplierName: "Fresh Farms", itemCount: 1 }]);
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    answer("Keep these items");
    fireEvent.click(button("Use the guide Weekly dry, 1 item"));
    expect(api.guideItems).not.toHaveBeenCalled();
  });

  it("prices a line again when its unit changes", async () => {
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    fireEvent.click(screen.getByRole("radio", { name: "kg" }));
    expect((screen.getByLabelText("Price per kg") as HTMLInputElement).value).toBe("1.4");
  });

  it("shows no price, stock or total the server left out, and says an unpriced item may need approval", async () => {
    render(<OrderNew />, ordersFor(admin));
    fireEvent.click(await find("Order from Fresh Farms"));
    type("Add an item", "gin");
    fireEvent.click(await find("Use Gin"));
    await find("Gin, 1 bottle");
    expect((screen.getByLabelText("Price per bottle") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/\$|In stock/)).toBeNull();
    expect(screen.getByText("1 item without a price. The order may need approval because of it.")).toBeTruthy();
  });

  it("offers the days to come, and another week", async () => {
    render(<OrderNew />, ordersFor(admin));
    await find("Save as draft");
    const days = () => screen.getByRole("radiogroup", { name: "Expected delivery (optional)" }).textContent;
    const first = days();
    fireEvent.click(button("Later days"));
    expect(days()).not.toBe(first);
    fireEvent.click(button("Earlier days"));
    expect(days()).toBe(first);
  });

  it("is kept on the phone: the list offers to continue it, also after a restart", async () => {
    const kv = memoryKv();
    const first = render(<OrderNew />, ordersFor(admin, kv));
    await addFlour();
    first.unmount();
    await new Promise((r) => setTimeout(r));
    const env = ordersFor(admin, kv);
    await env.ctx.draft.restore();
    render(<Orders />, env);
    expect(await find("Continue your order · 1 item")).toBeTruthy();
  });

  it("is thrown away only after a yes", async () => {
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    answer("Keep it");
    fireEvent.click(button("Discard this order"));
    expect(button(/^Flour, 1 bag/)).toBeTruthy();
    answer("Discard");
    fireEvent.click(button("Discard this order"));
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
  });

  it("with no signal says it needs a connection and keeps what was written", async () => {
    const kv = memoryKv();
    const first = render(<OrderNew />, ordersFor(admin, kv));
    await addFlour();
    first.unmount();
    await new Promise((r) => setTimeout(r));
    api.items.mockRejectedValue(new ApiError("network"));
    render(<OrderNew />, ordersFor(admin, kv));
    expect(await screen.findByText("Can't reach the server. Try again. Writing an order needs a connection. What you have so far is kept on this phone.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save as draft" })).toBeNull();
  });

  it("offers Save and submit only to someone who may submit, and nothing to someone who may not raise orders", async () => {
    const first = render(<OrderNew />, ordersFor(person(["inventory:count", "inventory:manage", "purchasing:draft"])));
    await find("Save as draft");
    expect(screen.queryByRole("button", { name: "Save and submit" })).toBeNull();
    first.unmount();
    api.suppliers.mockClear();
    render(<OrderNew />, ordersFor(person(["inventory:count", "purchasing:draft"])));
    expect(screen.getByText("You don't have permission to raise orders.")).toBeTruthy();
    expect(api.suppliers).not.toHaveBeenCalled();
  });

  it("searches a long list of suppliers", async () => {
    api.suppliers.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ supplierId: `s${i}`, supplierName: `Supplier ${i}` })));
    render(<OrderNew />, ordersFor(admin));
    await find("Order from Supplier 0");
    expect(screen.queryByRole("button", { name: "Order from Supplier 8" })).toBeNull();
    type("Supplier", "8");
    expect(await find("Order from Supplier 8")).toBeTruthy();
  });

  it("keeps to the column on an iPad", async () => {
    render(<OrderNew />, ordersFor(admin));
    await addFlour();
    let el: HTMLElement | null = button(/^Flour, 1 bag/);
    while (el && el.style.maxWidth !== `${COLUMN_WIDTH}px`) el = el.parentElement;
    expect(el).not.toBeNull();
  });
});
