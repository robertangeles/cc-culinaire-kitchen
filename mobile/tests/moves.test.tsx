// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { AREAS, NOW, makeStockHarness, serverMove, stockHarness } from "./stockHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/movements/MovementProvider", async () => {
  const { stockHarness } = await import("./stockHarness");
  return {
    useMovements: () => {
      const snap = useSyncExternalStore(stockHarness.moves.subscribe, stockHarness.moves.getSnapshot);
      return { store: stockHarness.moves, source: stockHarness.movesSource, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});
vi.mock("../src/runtime/appOutbox", async () => {
  const { stockHarness } = await import("./stockHarness");
  return { get outbox() { return stockHarness.outbox; }, runner: { kick: vi.fn() } };
});

import Moves from "../app/(app)/(moves)/index";
import MoveEntry from "../app/(app)/(moves)/move-entry";
import Account from "../app/(app)/account";

const cook = { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

beforeEach(() => {
  sessionState.current = { state: { phase: "ready", user: cook, location: main, locations: [main] }, busy: false };
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
/** A chip in one of the two area rows: both rows list the same areas. */
const choose = (row: "From" | "To", name: string) => fireEvent.click(within(screen.getByRole("radiogroup", { name: row })).getByRole("radio", { name }));
const chip = (row: "From" | "To", name: string) => within(screen.getByRole("radiogroup", { name: row })).getByRole("radio", { name });

describe("moves list", () => {
  it("shows the latest moves with their areas and time, and says a move changes no stock", async () => {
    await makeStockHarness({ movesOnServer: [serverMove(), serverMove({ stockMovementId: "m2", ingredientName: "Tonic", quantity: 12, unit: "each", fromAreaName: "Cool Room", toAreaName: "Bar" })] });
    render(<Moves />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("Gin")).toBeTruthy();
    expect(screen.getByText(/Stock Room → Bar · /)).toBeTruthy();
    expect(screen.getByText(/Cool Room → Bar · /)).toBeTruthy();
    expect(screen.getByText(/A move doesn't change your stock/)).toBeTruthy();
    press("Record a move");
    expect(routerMock.push).toHaveBeenCalledWith("/move-entry");
  });

  it("says so when nothing has moved yet", async () => {
    await makeStockHarness();
    render(<Moves />);
    expect(screen.getByText("Nothing moved yet.")).toBeTruthy();
  });

  it("explains a location with fewer than two areas instead of offering a move, as the web does", async () => {
    await makeStockHarness({ areas: [] });
    render(<Moves />);
    expect(screen.getByText("No areas yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record a move" })).toBeNull();
    cleanup();
    await makeStockHarness({ areas: [AREAS[0]] });
    render(<Moves />);
    expect(screen.getByText("You need a second area")).toBeTruthy();
  });

  it("tells the cook when the areas were never downloaded because there is no signal yet", async () => {
    await makeStockHarness({ listFails: new ApiError("network") });
    render(<Moves />);
    expect(screen.getByText(/You're offline\. Moves are saved on this phone/)).toBeTruthy();
    expect(screen.getByText(/areas have not been downloaded/)).toBeTruthy();
  });

  it("offers the latest moves again with the item, amount and areas filled in", async () => {
    const { moves } = await makeStockHarness();
    await moves.record({ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: 4, fromStorageAreaId: "a1", toStorageAreaId: "a2", notes: null });
    render(<Moves />);
    press("Move Gin again");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/move-entry", params: { name: "Gin", ingredientId: "i1", unit: "L", quantity: "4", from: "a1", to: "a2" } });
  });
});

describe("recording with no signal, then reconnecting", () => {
  it("records on the phone, shows it waiting, and shows it sent once the queue has drained", async () => {
    const { outbox, request } = await makeStockHarness();
    render(<MoveEntry />);
    type("What moved", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    type("How much", "4");
    choose("From", "Stock Room");
    expect(within(screen.getByRole("radiogroup", { name: "To" })).queryByRole("radio", { name: "Stock Room" })).toBeNull(); // not offered again as the place it goes to
    choose("To", "Bar");
    type("Note (optional)", "Friday service");
    press("Record move");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();

    cleanup();
    render(<Moves />);
    expect(screen.getByText("1 waiting to send")).toBeTruthy();
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.getByText("4 L")).toBeTruthy();

    await outbox.drain();
    await waitFor(() => expect(screen.queryByText("1 waiting to send")).toBeNull());
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/locations/L1/stock-movements", { body: expect.objectContaining({ ingredientId: "i1", fromStorageAreaId: "a1", toStorageAreaId: "a2", quantity: 4, unit: "L", notes: "Friday service" }) });
  });

  it("will not save without an item, an amount, or both areas, and says why", async () => {
    const { outbox } = await makeStockHarness();
    render(<MoveEntry />);
    press("Record move");
    expect(await screen.findByText("Pick the item from the list.")).toBeTruthy();
    type("What moved", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    press("Record move");
    expect(await screen.findByText("Enter how much moved.")).toBeTruthy();
    type("How much", "2");
    press("Record move");
    expect(await screen.findByText("Choose where it moved from and to.")).toBeTruthy();
    expect(await outbox.open(["movement.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("does not carry the previous item's unit to an item whose unit is not known", async () => {
    const { outbox } = await makeStockHarness();
    render(<MoveEntry />);
    type("What moved", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    expect(screen.getByText("In L, the unit this item is kept in.")).toBeTruthy();
    type("What moved", "myst");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Mystery oil" })).toBeTruthy());
    press("Use Mystery oil");
    expect(screen.queryByText(/^In L/)).toBeNull();
    type("How much", "2");
    choose("From", "Stock Room");
    choose("To", "Bar");
    press("Record move");
    expect(await screen.findByText("Pick the item from the list again: its unit is not known.")).toBeTruthy();
    expect(await outbox.open(["movement.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("opens filled in from the usage screen's 'Record as movement' or a 'Move again' button", async () => {
    await makeStockHarness();
    searchParams.current = { name: "Gin", ingredientId: "i1", unit: "L", quantity: "1", from: "a1", to: "a2" };
    render(<MoveEntry />);
    expect((screen.getByLabelText("What moved") as HTMLInputElement).value).toBe("Gin");
    expect((screen.getByLabelText("How much") as HTMLInputElement).value).toBe("1");
    expect(chip("From", "Stock Room").getAttribute("aria-checked")).toBe("true");
    expect(chip("To", "Bar").getAttribute("aria-checked")).toBe("true");
    press("Record move");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await stockHarness.outbox.open(["movement.log"]))[0].command).toMatchObject({ ingredientId: "i1", fromAreaName: "Stock Room", toAreaName: "Bar", quantity: 1 });
  });

  it("does not pre-choose an area that has since been removed", async () => {
    await makeStockHarness();
    searchParams.current = { name: "Gin", ingredientId: "i1", unit: "L", quantity: "1", from: "gone", to: "a2" };
    render(<MoveEntry />);
    expect(chip("From", "Stock Room").getAttribute("aria-checked")).toBe("false");
    expect(chip("To", "Bar").getAttribute("aria-checked")).toBe("true");
  });
});

describe("a refusal stays visible", () => {
  it("shows the server's words with Try again and Discard on the move", async () => {
    const request = vi.fn(async () => { throw new ApiError("not_found", "That 'to' area isn't at this location", 404, undefined, "NOT_FOUND"); });
    const { moves, outbox } = await makeStockHarness({ send: request });
    await moves.record({ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: 4, fromStorageAreaId: "a1", toStorageAreaId: "a2", notes: null });
    await outbox.drain();
    vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === "Discard")?.onPress?.());
    render(<Moves />);
    expect(screen.getByText(/1 move needs attention/)).toBeTruthy();
    expect(screen.getByText(/That 'to' area isn't at this location/)).toBeTruthy();
    press("Discard");
    await waitFor(() => expect(screen.queryByText(/needs attention/)).toBeNull());
    expect(screen.getByText("Nothing moved yet.")).toBeTruthy();
  });
});

describe("account tab", () => {
  it("lists a stuck move on this phone", async () => {
    const request = vi.fn(async () => { throw new ApiError("bad_request", "That area is no longer in use", 400, undefined, "VALIDATION"); });
    const { moves, outbox } = await makeStockHarness({ send: request });
    await moves.record({ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: 4, fromStorageAreaId: "a1", toStorageAreaId: "a3", notes: null });
    await outbox.drain();
    render(<Account />);
    await waitFor(() => expect(screen.getByText("Move: 4 L Gin, Stock Room to Cool Room")).toBeTruthy());
    expect(screen.getByText(/That area is no longer in use/)).toBeTruthy();
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts both move screens in the app's 560 dp column, centred, on %s (jsdom does no layout, so the constraints are checked at that window size)", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    await makeStockHarness({ movesOnServer: [serverMove()] });
    for (const Screen of [Moves, MoveEntry]) {
      const { container, unmount } = render(<Screen />);
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px");
      expect(column, "a 560 dp column").toBeTruthy();
      expect(getComputedStyle(column!).width).toBe("100%");
      expect(getComputedStyle(column!).alignSelf).toBe("center");
      unmount();
    }
  });
});
