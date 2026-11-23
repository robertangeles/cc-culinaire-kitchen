// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { NOW } from "./stockHarness";
import { dashboard, item, makeStoreRoom } from "./storeRoomHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/stock/StockProvider", async () => {
  const { storeRoom } = await import("./storeRoomHarness");
  return {
    useStock: () => {
      const snap = useSyncExternalStore(storeRoom.stock.subscribe, storeRoom.stock.getSnapshot);
      return { store: storeRoom.stock, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});
vi.mock("../src/runtime/appOutbox", async () => {
  const { storeRoom } = await import("./storeRoomHarness");
  return { get outbox() { return storeRoom.outbox; }, runner: { kick: vi.fn() } };
});

import StockHome from "../app/(app)/(stock)/index";
import Items from "../app/(app)/(stock)/items";
import ItemScreen from "../app/(app)/(stock)/item/[ingredientId]";
import RequestNew from "../app/(app)/(stock)/request-new";
import Requests from "../app/(app)/(stock)/requests";

const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const signIn = (permissions: string[]) => (sessionState.current = { state: { phase: "ready", user: { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions }, location: main, locations: [main] }, busy: false });

beforeEach(() => {
  signIn(["inventory:count", "inventory:cost"]);
  searchParams.current = {};
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

describe("the stock dashboard", () => {
  const withValue = dashboard({ activeSession: { submitted: 1, total: 3 } }, { lowIngredientIds: ["i2"], stockValue: 1520.4, valueByCategory: [{ category: "spirits", value: 1200 }, { category: "dry_goods", value: 320.4 }] });
  const items = [item(), item({ ingredientId: "i2", ingredientName: "Tonic", ingredientCategory: "beverages", baseUnit: "each", currentQty: 10, parLevel: 24 })];

  it("shows the server's critical and low counts, opens each list to its items and an item to its page, and the value for a cost holder", async () => {
    await makeStoreRoom({ dashboard: withValue, items });
    render(<StockHome />);
    expect(screen.getByRole("button", { name: "Critical, reorder now: 1 item" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Low stock, keep an eye on it: 1 item" })).toBeTruthy();
    expect(screen.getByText("$1,520")).toBeTruthy();
    expect(screen.getByLabelText("Spirits, $1,200")).toBeTruthy();
    expect(screen.getByText("Stock take in progress: 1 of 3 submitted")).toBeTruthy();
    press("Low stock, keep an eye on it: 1 item");
    press("Tonic, on hand 10 each, par 24 each");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/item/[ingredientId]", params: { ingredientId: "i2" } });
  });

  it("shows a blind counter the same lists with dashes for quantities and no value at all", async () => {
    signIn(["inventory:count"]);
    await makeStoreRoom({ canSeeQty: false, dashboard: dashboard({ stockLevels: [{ ingredientId: "i1", ingredientName: "Gin", ingredientCategory: "spirits", baseUnit: "L", parLevel: 6 }] }), items });
    render(<StockHome />);
    press("Critical, reorder now: 1 item");
    expect(screen.getByRole("button", { name: "Gin, on hand —, par 6 L" })).toBeTruthy();
    expect(screen.queryByText("Stock value")).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("says when nothing is low and nothing has been counted yet", async () => {
    await makeStoreRoom({ dashboard: dashboard({ stockLevels: [] }, { criticalIngredientIds: [] }) });
    render(<StockHome />);
    expect(screen.getByText("Nothing is low or critical against its par.")).toBeTruthy();
    expect(screen.getByText("No stock figures yet")).toBeTruthy();
  });

  it("says it is offline and that nothing was downloaded yet", async () => {
    await makeStoreRoom({ readsFail: new ApiError("network") });
    render(<StockHome />);
    expect(screen.getByText(/the stock figures have not been downloaded to this phone yet/)).toBeTruthy();
  });

  it("leads to lookup, a new request and my requests", async () => {
    await makeStoreRoom();
    render(<StockHome />);
    press("Look up an item");
    press("Ask for a new item");
    press("My requests");
    expect(routerMock.push.mock.calls.slice(-3)).toEqual([["/items"], ["/request-new"], ["/requests"]]);
  });
});

describe("item lookup", () => {
  const items = [item(), item({ ingredientId: "i4", ingredientName: "Basil", ingredientCategory: "produce", baseUnit: "bunch", currentQty: 2 })];
  const catalogue = [{ ingredientId: "i1", ingredientName: "Gin", baseUnit: "L", ingredientCategory: "spirits" }, { ingredientId: "i3", ingredientName: "Gin syrup", baseUnit: "L", ingredientCategory: "spirits" }];

  it("lists the items used here, searches the whole catalogue, and asks for what is missing", async () => {
    await makeStoreRoom({ items, catalogue });
    render(<Items />);
    expect(screen.getAllByRole("button", { name: /, on hand / }).map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual(["Basil", "Gin"]);
    type("Search the catalogue", "gin");
    expect(screen.getByRole("button", { name: "Gin syrup, Spirits, on hand —, not used here" })).toBeTruthy();
    type("Search the catalogue", "yuzu");
    expect(screen.getByText('Nothing in the catalogue matches "yuzu".')).toBeTruthy();
    press("Not in the catalogue? Ask for it");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/request-new", params: { name: "yuzu" } });
  });

  it("shows an item's stock here against par, the server's flag, where it is kept and, for a manager, every location", async () => {
    signIn(["inventory:count", "inventory:manage", "inventory:cost"]);
    searchParams.current = { ingredientId: "i1" };
    await makeStoreRoom({ items, elsewhere: [{ storeLocationId: "L1", locationName: "Main Kitchen", currentQty: 1, parLevel: 6 }, { storeLocationId: "L2", locationName: "Bar", currentQty: null, parLevel: null }] });
    render(<ItemScreen />);
    expect(screen.getByText("Gin")).toBeTruthy();
    expect(screen.getByText("Critical, reorder now")).toBeTruthy();
    expect(screen.getByText("1 L")).toBeTruthy();
    expect(screen.getByText("6 L")).toBeTruthy();
    expect(screen.getByText("Back Bar")).toBeTruthy();
    expect(await screen.findByLabelText("Bar, on hand —, par —")).toBeTruthy();
  });

  it("shows a blind counter a dash for what is on hand, and no other locations", async () => {
    signIn(["inventory:count"]);
    searchParams.current = { ingredientId: "i1" };
    await makeStoreRoom({ canSeeQty: false, items });
    render(<ItemScreen />);
    const onHand = screen.getByText("On hand").parentElement!;
    expect(within(onHand).getByText("—")).toBeTruthy();
    expect(screen.queryByText("At every location")).toBeNull();
  });
});

describe("catalogue requests", () => {
  it("asks for a new item through the queue and lists it as waiting, then sent for review", async () => {
    searchParams.current = { name: "Yuzu juice" };
    const { outbox, request } = await makeStoreRoom();
    render(<RequestNew />);
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("Yuzu juice");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Type (optional)" })).getByRole("radio", { name: "Kitchen Ingredient" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Category (optional)" })).getByRole("radio", { name: "Beverages" }));
    type("Unit it's counted in (optional)", "L");
    type("How many you have now (optional)", "2");
    press("Send request");
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/requests"));
    cleanup();
    render(<Requests />);
    expect(screen.getByLabelText("Yuzu juice, Waiting to send")).toBeTruthy();
    expect(screen.getByText(/Beverages · 2 L on hand/)).toBeTruthy();
    await outbox.drain();
    await waitFor(() => expect(screen.getByLabelText("Yuzu juice, Sent for review")).toBeTruthy());
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/catalog-requests", { body: { requestId: "00000000-0000-4000-8000-000000000001", storeLocationId: "L1", itemName: "Yuzu juice", itemType: "KITCHEN_INGREDIENT", category: "beverages", baseUnit: "L", countedQty: 2 } });
  });

  it("will not send a request with no name, and says why", async () => {
    await makeStoreRoom();
    render(<RequestNew />);
    press("Send request");
    expect(await screen.findByText("Give the item a name.")).toBeTruthy();
  });

  it("says when there are no requests yet", async () => {
    await makeStoreRoom();
    render(<Requests />);
    expect(screen.getByText("You haven't asked for a new item from this phone.")).toBeTruthy();
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts the stock screens in the app's 560 dp column, centred, on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    searchParams.current = { ingredientId: "i1" };
    await makeStoreRoom();
    for (const Screen of [StockHome, Items, ItemScreen, RequestNew, Requests]) {
      const { container, unmount } = render(<Screen />);
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px");
      expect(column, "a 560 dp column").toBeTruthy();
      expect(getComputedStyle(column!).alignSelf).toBe("center");
      unmount();
    }
  });
});
