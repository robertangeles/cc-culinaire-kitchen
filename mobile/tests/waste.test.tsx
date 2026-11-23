// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { NOW, makeWasteHarness, serverEntry, wasteHarness } from "./wasteHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/waste/WasteProvider", async () => {
  const { wasteHarness } = await import("./wasteHarness");
  return {
    useWaste: () => {
      const snap = useSyncExternalStore(wasteHarness.store.subscribe, wasteHarness.store.getSnapshot);
      return { store: wasteHarness.store, source: wasteHarness.source, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});
vi.mock("../src/runtime/appOutbox", async () => {
  const { wasteHarness } = await import("./wasteHarness");
  return { get outbox() { return wasteHarness.outbox; }, runner: { kick: vi.fn() } };
});

import Waste from "../app/(app)/(waste)/index";
import WasteEntry from "../app/(app)/(waste)/waste-entry";
import Account from "../app/(app)/account";

const cook = { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["waste:log"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

beforeEach(() => {
  sessionState.current = { state: { phase: "ready", user: cook, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

describe("waste list", () => {
  it("shows today's totals per unit, each entry with its time, reason and shift, and no cost it does not have", async () => {
    await makeWasteHarness({ onServer: [serverEntry(), serverEntry({ wasteLogId: "w2", ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", reason: "Trim/Peel", shift: null, estimatedCost: 6 })] });
    render(<Waste />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("2.5 kg · 1 bunch")).toBeTruthy();
    expect(screen.getByText("2 entries · $6.00")).toBeTruthy();
    expect(screen.getByText("Basil")).toBeTruthy();
    expect(screen.getByText(/Spoilage · Lunch/)).toBeTruthy();
    expect(screen.queryByText(/waiting to send/i)).toBeNull();
  });

  it("says so when nothing is logged yet, and opens the log screen", async () => {
    await makeWasteHarness();
    render(<Waste />);
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
    press("Log waste");
    expect(routerMock.push).toHaveBeenCalledWith("/waste-entry");
  });

  it("tells the cook they are offline, and still shows what was downloaded last", async () => {
    await makeWasteHarness({ listFails: new ApiError("network") });
    render(<Waste />);
    expect(screen.getByText(/You're offline\. Waste is saved on this phone/)).toBeTruthy();
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
  });

  it("offers the latest items as buttons that open the log with the item, unit and last quantity filled in", async () => {
    const { waste } = await makeWasteHarness();
    await waste.log({ ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", reason: null, shift: null, estimatedCost: null, notes: null });
    render(<Waste />);
    fireEvent.click(screen.getByRole("button", { name: "Log Chicken trim again" }));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/waste-entry", params: { name: "Chicken trim", unit: "kg", quantity: "2.5" } });
  });
});

describe("logging with no signal, then reconnecting", () => {
  it("logs on the phone, shows it waiting, and shows it sent once the queue has drained", async () => {
    const { outbox, request } = await makeWasteHarness();
    render(<WasteEntry />);
    type("What was thrown away", "Chicken trim");
    type("How much", "2.5");
    fireEvent.click(screen.getByRole("radio", { name: "Trim/Peel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Lunch" }));
    press("Log waste");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled(); // saved on the phone; nothing needed the network

    cleanup();
    render(<Waste />);
    expect(screen.getByText("1 waiting to send")).toBeTruthy();
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.getAllByText("2.5 kg")).toHaveLength(2); // the entry, and the day's total already counts it

    await outbox.drain(); // signal is back
    await waitFor(() => expect(screen.queryByText("1 waiting to send")).toBeNull());
    expect(request).toHaveBeenCalledWith("POST", "/api/waste", expect.objectContaining({ body: expect.objectContaining({ ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", reason: "Trim/Peel", shift: "Lunch", storeLocationId: "L1" }) }));
    expect(screen.queryByText("Waiting to send")).toBeNull();
  });

  it("will not save without a name or a quantity above zero, and says why", async () => {
    const { outbox } = await makeWasteHarness();
    render(<WasteEntry />);
    press("Log waste");
    expect(screen.getByText("Say what was thrown away.")).toBeTruthy();
    type("What was thrown away", "Basil");
    type("How much", "0");
    press("Log waste");
    expect(screen.getByText("Enter a quantity above zero.")).toBeTruthy();
    type("How much", "-2");
    press("Log waste");
    expect(screen.getByText("Enter a quantity above zero.")).toBeTruthy();
    expect(await outbox.open(["waste.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("opens filled in from a quick button", async () => {
    await makeWasteHarness();
    searchParams.current = { name: "Basil", unit: "bunch", quantity: "2" };
    render(<WasteEntry />);
    expect((screen.getByLabelText("What was thrown away") as HTMLInputElement).value).toBe("Basil");
    expect((screen.getByLabelText("How much") as HTMLInputElement).value).toBe("2");
    expect(screen.getByRole("radio", { name: "bunch" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("ingredient picker on the log screen", () => {
  it("offers matches from the catalogue as the cook types, and fills the unit the item is kept in", async () => {
    await makeWasteHarness({ catalogue: [{ ingredientId: "i1", ingredientName: "Chickpeas", baseUnit: "g", ingredientCategory: "Dry" }, { ingredientId: "i2", ingredientName: "Basil", baseUnit: "bunch", ingredientCategory: "" }] });
    render(<WasteEntry />);
    type("What was thrown away", "chick");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Chickpeas" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Use Basil" })).toBeNull();
    press("Use Chickpeas");
    expect((screen.getByLabelText("What was thrown away") as HTMLInputElement).value).toBe("Chickpeas");
    expect(screen.getByRole("radio", { name: "g" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "Use Chickpeas" })).toBeNull(); // the list closes once picked
  });

  it("adds the server's own names a moment later, and accepts a name that is in no list", async () => {
    vi.useRealTimers();
    await makeWasteHarness({ moreNames: async () => ["Chicken wings"] });
    render(<WasteEntry />);
    type("What was thrown away", "chic");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Chicken wings" })).toBeTruthy());
    type("What was thrown away", "Leftover risotto");
    type("How much", "1");
    press("Log waste");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await wasteHarness.outbox.open(["waste.log"]))[0].command).toMatchObject({ ingredientName: "Leftover risotto" });
  });

  it("offers recent items before anything is typed", async () => {
    const { waste } = await makeWasteHarness();
    await waste.log({ ingredientName: "Basil", quantity: 1, unit: "bunch", reason: null, shift: null, estimatedCost: null, notes: null });
    render(<WasteEntry />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Basil" })).toBeTruthy());
  });
});

describe("changing and deleting", () => {
  it("changes only what the cook changed", async () => {
    const { outbox } = await makeWasteHarness({ onServer: [serverEntry()] });
    searchParams.current = { id: "w1" };
    render(<WasteEntry />);
    expect(screen.getByText("Change waste entry")).toBeTruthy();
    expect((screen.getByLabelText("How much") as HTMLInputElement).value).toBe("1");
    type("How much", "3");
    press("Save changes");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await outbox.open(["waste.edit"]))[0].command).toEqual({ wasteLogId: "w1", label: "Basil", changes: { quantity: 3 } });
  });

  it("deletes after a confirmation, and the entry leaves the list at once", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === "destructive")?.onPress?.());
    const { outbox } = await makeWasteHarness({ onServer: [serverEntry()] });
    searchParams.current = { id: "w1" };
    render(<WasteEntry />);
    press("Delete this entry");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith("Delete Basil?", expect.any(String), expect.any(Array));
    expect((await outbox.open(["waste.delete"]))).toHaveLength(1);
    cleanup();
    render(<Waste />);
    expect(screen.queryByText("Basil")).toBeNull();
    alert.mockRestore();
  });
});

describe("a refusal stays visible", () => {
  it("shows the server's words with Try again and Discard on the entry, and a count of what needs attention", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === "destructive")?.onPress?.());
    const request = vi.fn(async () => { throw new ApiError("forbidden", "You don't work at that location", 403, undefined, "LOCATION_NOT_ALLOWED"); });
    const { waste, outbox } = await makeWasteHarness({ send: request });
    await waste.log({ ingredientName: "Chicken trim", quantity: 2, unit: "kg", reason: null, shift: null, estimatedCost: null, notes: null });
    await outbox.drain();
    render(<Waste />);
    expect(screen.getByText(/1 entry needs attention/)).toBeTruthy();
    expect(screen.getByText(/You don't work at that location/)).toBeTruthy();
    press("Try again");
    await waitFor(() => expect(screen.getByText("1 waiting to send")).toBeTruthy());
    await outbox.drain();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy());
    press("Discard");
    await waitFor(() => expect(screen.queryByText(/needs attention/)).toBeNull());
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
    alert.mockRestore();
  });
});

describe("account tab", () => {
  it("lists anything stuck on this phone with Try again and Discard", async () => {
    const request = vi.fn(async () => { throw new ApiError("bad_request", "Quantity must be positive", 400); });
    const { waste, outbox } = await makeWasteHarness({ send: request });
    await waste.log({ ingredientName: "Gin", quantity: 1, unit: "L", reason: null, shift: null, estimatedCost: null, notes: null });
    await outbox.drain();
    render(<Account />);
    await waitFor(() => expect(screen.getByText("Waste: 1 L Gin")).toBeTruthy());
    expect(screen.getByText(/Quantity must be positive/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows nothing about the queue when it is empty", async () => {
    await makeWasteHarness();
    render(<Account />);
    expect(screen.queryByText(/waiting to send/)).toBeNull();
  });
});

describe("tablet width", () => {
  it("puts the waste screens in a column that fills the width up to the app's 560 dp column and sits in the middle (so a phone is full width, an iPad is capped; jsdom does no layout, so the constraints are checked)", async () => {
    await makeWasteHarness({ onServer: [serverEntry()] });
    const { container } = render(<Waste />);
    const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px");
    expect(column, "a 560 dp column").toBeTruthy();
    const style = getComputedStyle(column!);
    expect(style.width).toBe("100%");
    expect(style.alignSelf).toBe("center");
  });
});
