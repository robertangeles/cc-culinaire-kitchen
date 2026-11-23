// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { NOW, makeStockHarness, serverUsage, stockHarness } from "./stockHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/consumption/ConsumptionProvider", async () => {
  const { stockHarness } = await import("./stockHarness");
  return {
    useConsumption: () => {
      const snap = useSyncExternalStore(stockHarness.usage.subscribe, stockHarness.usage.getSnapshot);
      return { store: stockHarness.usage, source: stockHarness.usageSource, snap };
    },
  };
});
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, googleEnabled: false, useSession: () => sessionState.current };
});
vi.mock("../src/runtime/appOutbox", async () => {
  const { stockHarness } = await import("./stockHarness");
  return { get outbox() { return stockHarness.outbox; }, runner: { kick: vi.fn() } };
});

import Usage from "../app/(app)/(usage)/index";
import UsageEntry from "../app/(app)/(usage)/usage-entry";
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
const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
/** Answers an Alert by pressing the button with this text. */
const answerAlert = (text: string) => vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === text)?.onPress?.());

describe("usage list", () => {
  it("shows today's totals per unit with returns kept apart, each entry with time, reason and shift, and another person's entry read-only with their name", async () => {
    await makeStockHarness({ usageOnServer: [serverUsage(), serverUsage({ consumptionLogId: "c2", ingredientName: "Salt", quantity: 2, unit: "kg", reason: "kitchen_operations", shift: null }), serverUsage({ consumptionLogId: "c3", ingredientName: "Lemons", quantity: 3, unit: "each", reason: "return_to_stock", shift: null }), serverUsage({ consumptionLogId: "c4", ingredientName: "Rum", quantity: 1, unit: "L", reason: "staff_consumption", shift: null, userId: 9, userName: "Sam" })] });
    render(<Usage />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("2 kg · 1.7 L")).toBeTruthy();
    expect(screen.getByText("4 entries · returned 3 each")).toBeTruthy();
    expect(screen.getByText(/FOH · Eve/)).toBeTruthy();
    expect(screen.getByText(/Staff · Sam/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Gin, 0.7 L, sent. Edit$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Rum/ })).toBeNull(); // not theirs: no edit button
    expect(screen.getByLabelText(/^Rum, 1 L, logged by Sam$/)).toBeTruthy();
  });

  it("says so when nothing is logged yet, and opens the log screen", async () => {
    await makeStockHarness();
    render(<Usage />);
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
    press("Log usage");
    expect(routerMock.push).toHaveBeenCalledWith("/usage-entry");
  });

  it("tells the cook they are offline, and still shows what was downloaded last", async () => {
    await makeStockHarness({ listFails: new ApiError("network") });
    render(<Usage />);
    expect(screen.getByText(/You're offline\. Usage is saved on this phone/)).toBeTruthy();
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
  });

  it("offers the latest items as buttons that open the log with item, unit, quantity and reason filled in", async () => {
    const { usage } = await makeStockHarness();
    await usage.log({ ingredientId: "i3", ingredientName: "Salt", itemType: "KITCHEN_INGREDIENT", unit: "kg", quantity: 2, reason: "kitchen_operations", shift: null, notes: null });
    render(<Usage />);
    press("Log Salt again");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/usage-entry", params: { name: "Salt", ingredientId: "i3", itemType: "KITCHEN_INGREDIENT", unit: "kg", quantity: "2", reason: "kitchen_operations" } });
  });
});

describe("logging with no signal, then reconnecting", () => {
  it("logs on the phone, shows it waiting, and shows it sent once the queue has drained", async () => {
    const { outbox, request } = await makeStockHarness();
    render(<UsageEntry />);
    type("What was used", "sal");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Salt" })).toBeTruthy());
    press("Use Salt");
    expect(screen.getByText("In kg, the unit this item is kept in.")).toBeTruthy();
    type("How much", "2.5");
    choose("Kitchen");
    choose("AM");
    press("Log usage");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled(); // saved on the phone; nothing needed the network

    cleanup();
    render(<Usage />);
    expect(screen.getByText("1 waiting to send")).toBeTruthy();
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.getAllByText("2.5 kg")).toHaveLength(2); // the entry, and the day's total already counts it

    await outbox.drain(); // signal is back
    await waitFor(() => expect(screen.queryByText("1 waiting to send")).toBeNull());
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/consumption-logs", { body: expect.objectContaining({ ingredientId: "i3", quantity: 2.5, unit: "kg", reason: "kitchen_operations", shift: "morning", storeLocationId: "L1" }) });
  });

  it("will not save without a picked item, a quantity above zero or a reason, and says why", async () => {
    const { outbox } = await makeStockHarness();
    render(<UsageEntry />);
    type("What was used", "Salty");
    press("Log usage");
    expect(screen.getByText("Pick the item from the list.")).toBeTruthy();
    type("What was used", "sal");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Salt" })).toBeTruthy());
    press("Use Salt");
    type("How much", "0");
    press("Log usage");
    expect(screen.getByText("Enter a quantity above zero.")).toBeTruthy();
    type("How much", "1");
    press("Log usage");
    expect(screen.getByText("Say what it was used for.")).toBeTruthy();
    expect(await outbox.open(["consumption.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("does not carry the previous item's unit to an item whose unit is not known", async () => {
    const { outbox } = await makeStockHarness();
    render(<UsageEntry />);
    type("What was used", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    expect(screen.getByText("In L, the unit this item is kept in.")).toBeTruthy();
    type("What was used", "myst");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Mystery oil" })).toBeTruthy());
    press("Use Mystery oil");
    expect(screen.queryByText(/^In L/)).toBeNull();
    type("How much", "1");
    choose("Kitchen");
    press("Log usage");
    expect(await screen.findByText("Pick the item from the list again: its unit is not known.")).toBeTruthy();
    expect(await outbox.open(["consumption.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("opens filled in from a quick button", async () => {
    await makeStockHarness();
    searchParams.current = { name: "Salt", ingredientId: "i3", unit: "kg", quantity: "2", reason: "kitchen_operations" };
    render(<UsageEntry />);
    expect((screen.getByLabelText("What was used") as HTMLInputElement).value).toBe("Salt");
    expect((screen.getByLabelText("How much") as HTMLInputElement).value).toBe("2");
    expect(screen.getByRole("radio", { name: "Kitchen" }).getAttribute("aria-checked")).toBe("true");
    press("Log usage");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await stockHarness.outbox.open(["consumption.log"]))[0].command).toMatchObject({ ingredientId: "i3", quantity: 2, unit: "kg" });
  });
});

describe("that's a move, not usage", () => {
  const fillGinForFoh = async () => {
    render(<UsageEntry />);
    type("What was used", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    type("How much", "1");
    choose("FOH");
  };

  it("asks before logging FOH usage of a kitchen ingredient, and does nothing on Go back", async () => {
    const { outbox } = await makeStockHarness();
    const alert = answerAlert("Go back");
    await fillGinForFoh();
    press("Log usage");
    expect(alert).toHaveBeenCalledWith("Taking stock to the bar or front of house?", expect.stringContaining("Gin stays at this site"), expect.any(Array));
    expect(await outbox.open(["consumption.log"])).toEqual([]);
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("logs it as usage when the cook says so", async () => {
    const { outbox } = await makeStockHarness();
    answerAlert("Log as usage anyway");
    await fillGinForFoh();
    press("Log usage");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await outbox.open(["consumption.log"]))[0].command).toMatchObject({ ingredientId: "i1", reason: "foh_operations" });
  });

  it("hands the item and amount to the move screen instead, logging no usage", async () => {
    const { outbox } = await makeStockHarness();
    answerAlert("Record as movement");
    await fillGinForFoh();
    press("Log usage");
    expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/move-entry", params: { name: "Gin", ingredientId: "i1", itemType: "KITCHEN_INGREDIENT", unit: "L", quantity: "1" } });
    expect(await outbox.open(["consumption.log"])).toEqual([]);
  });

  it("does not ask for operational supplies such as napkins, which really are used", async () => {
    const { outbox } = await makeStockHarness();
    const alert = vi.spyOn(Alert, "alert");
    render(<UsageEntry />);
    type("What was used", "napk");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Napkins" })).toBeTruthy());
    press("Use Napkins");
    type("How much", "20");
    choose("FOH");
    press("Log usage");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect((await outbox.open(["consumption.log"]))).toHaveLength(1);
  });
});

describe("changing and deleting", () => {
  it("changes only what the cook changed, and shows the entry's item without letting it be swapped", async () => {
    const { outbox } = await makeStockHarness({ usageOnServer: [serverUsage()] });
    searchParams.current = { id: "c1" };
    render(<UsageEntry />);
    expect(screen.getByText("Change usage entry")).toBeTruthy();
    expect(screen.queryByLabelText("What was used")).toBeNull();
    expect((screen.getByLabelText("How much") as HTMLInputElement).value).toBe("0.7");
    type("How much", "1");
    press("Save changes");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await outbox.open(["consumption.edit"]))[0].command).toEqual({ consumptionLogId: "c1", label: "Gin", changes: { quantity: 1 } });
  });

  it("clears a shift by tapping it again, sending null", async () => {
    const { outbox } = await makeStockHarness({ usageOnServer: [serverUsage()] });
    searchParams.current = { id: "c1" };
    render(<UsageEntry />);
    choose("Eve");
    press("Save changes");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect((await outbox.open(["consumption.edit"]))[0].command).toMatchObject({ changes: { shift: null } });
  });

  it("deletes after a confirmation, and the entry leaves the list at once", async () => {
    const alert = answerAlert("Delete");
    const { outbox } = await makeStockHarness({ usageOnServer: [serverUsage()] });
    searchParams.current = { id: "c1" };
    render(<UsageEntry />);
    press("Delete this entry");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(alert).toHaveBeenCalledWith("Delete Gin?", expect.stringContaining("stock is put back"), expect.any(Array));
    expect(await outbox.open(["consumption.delete"])).toHaveLength(1);
    cleanup();
    render(<Usage />);
    expect(screen.queryByText("Gin")).toBeNull();
  });
});

describe("a refusal stays visible", () => {
  it("shows the server's words with Try again and Discard on the entry, and a count of what needs attention", async () => {
    const request = vi.fn(async () => { throw new ApiError("bad_request", "Cannot convert bottle to kg", 422, undefined, "INCOMPATIBLE_UNITS"); });
    const { usage, outbox } = await makeStockHarness({ send: request });
    await usage.log({ ingredientId: "i3", ingredientName: "Salt", unit: "kg", quantity: 2, reason: "kitchen_operations", shift: null, notes: null });
    await outbox.drain();
    answerAlert("Discard");
    render(<Usage />);
    expect(screen.getByText(/1 entry needs attention/)).toBeTruthy();
    expect(screen.getByText(/Cannot convert bottle to kg/)).toBeTruthy();
    press("Try again");
    await waitFor(() => expect(screen.getByText("1 waiting to send")).toBeTruthy());
    await outbox.drain();
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy());
    press("Discard");
    await waitFor(() => expect(screen.queryByText(/needs attention/)).toBeNull());
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
  });

  it("keeps an edit refused after the 24 hour window on the entry, with the server's words", async () => {
    const request = vi.fn(async () => { throw new ApiError("conflict", "Cannot edit entries older than 24 hours", 409, undefined, "EDIT_WINDOW_EXPIRED"); });
    const { usage, outbox } = await makeStockHarness({ send: request, usageOnServer: [serverUsage()] });
    await usage.edit("c1", { quantity: 3 });
    await outbox.drain();
    render(<Usage />);
    expect(screen.getByText(/Cannot edit entries older than 24 hours/)).toBeTruthy();
  });
});

describe("account tab", () => {
  it("lists a stuck usage entry on this phone with Try again and Discard", async () => {
    const request = vi.fn(async () => { throw new ApiError("bad_request", "Cannot convert bottle to kg", 422); });
    const { usage, outbox } = await makeStockHarness({ send: request });
    await usage.log({ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: 1, reason: "other", shift: null, notes: null });
    await outbox.drain();
    render(<Account />);
    await waitFor(() => expect(screen.getByText("Usage: 1 L Gin")).toBeTruthy());
    expect(screen.getByText(/Cannot convert bottle to kg/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts both usage screens in the app's 560 dp column, centred, on %s (jsdom does no layout, so the constraints are checked at that window size)", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    await makeStockHarness({ usageOnServer: [serverUsage()] });
    for (const Screen of [Usage, UsageEntry]) {
      const { container, unmount } = render(<Screen />);
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px");
      expect(column, "a 560 dp column").toBeTruthy();
      expect(getComputedStyle(column!).width).toBe("100%");
      expect(getComputedStyle(column!).alignSelf).toBe("center");
      unmount();
    }
  });
});
