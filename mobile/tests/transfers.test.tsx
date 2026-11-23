// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { NOW } from "./stockHarness";
import { detailOf, item, line, makeStoreRoom, transfer } from "./storeRoomHarness";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/transfers/TransferProvider", async () => {
  const { storeRoom } = await import("./storeRoomHarness");
  return {
    useTransfers: () => {
      const snap = useSyncExternalStore(storeRoom.transfers.subscribe, storeRoom.transfers.getSnapshot);
      return { store: storeRoom.transfers, source: storeRoom.source, snap };
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

import Transfers from "../app/(app)/(transfers)/index";
import TransferNew from "../app/(app)/(transfers)/transfer-new";
import TransferScreen from "../app/(app)/(transfers)/transfer/[transferId]";

const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const bar = { storeLocationId: "L2", organisationId: 1, locationName: "Bar", classification: "branch" };
const person = (permissions: string[]) => ({ userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions });
const signIn = (permissions: string[], locations = [main, bar]) => (sessionState.current = { state: { phase: "ready", user: person(permissions), location: main, locations }, busy: false });

beforeEach(() => {
  signIn(["inventory:count", "inventory:manage", "inventory:cost"]);
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

describe("the transfer list", () => {
  it("puts what is on its way here first, then what was sent from here, then what arrived, each opening the transfer", async () => {
    await makeStoreRoom({ transfers: [
      transfer({ transferId: "out", toLocationName: "Bar" }),
      transfer({ transferId: "due", fromLocationId: "L2", toLocationId: "L1", fromLocationName: "Bar", toLocationName: "Main Kitchen", status: "SENT", lineCount: 3 }),
      transfer({ transferId: "in", fromLocationId: "L2", toLocationId: "L1", fromLocationName: "Bar", status: "DISCREPANCY" }),
    ] });
    render(<Transfers />);
    const labels = screen.getAllByText(/^(To receive|Sent from here|Received here)$/).map((e) => e.textContent);
    expect(labels).toEqual(["To receive", "Sent from here", "Received here"]);
    expect(screen.getByRole("button", { name: /^From Bar, 3 items, On its way/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^To Bar, 1 item, Not sent yet/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^From Bar, 1 item, Received with differences/ })).toBeTruthy();
    press(/^From Bar, 3 items/);
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/transfer/[transferId]", params: { transferId: "due" } });
    press("New transfer");
    expect(routerMock.push).toHaveBeenCalledWith("/transfer-new");
  });

  it("offers no New transfer to someone who may only count and receive, as the server refuses them", async () => {
    signIn(["inventory:count"]);
    await makeStoreRoom();
    render(<Transfers />);
    expect(screen.queryByRole("button", { name: "New transfer" })).toBeNull();
    expect(screen.getByText("No transfers sent from here yet.")).toBeTruthy();
  });

  it("keeps a refused change on its transfer with the server's words, Try again and Discard", async () => {
    const { outbox, transfers } = await makeStoreRoom({ transfers: [transfer()], send: vi.fn(async () => { throw new ApiError("conflict", "Cannot send a transfer with status CANCELLED", 409, undefined, "INVALID_STATE"); }) });
    await transfers.send("t1");
    await outbox.drain();
    render(<Transfers />);
    await waitFor(() => expect(screen.getByText(/Cannot send a transfer with status CANCELLED/)).toBeTruthy());
    expect(screen.getByText("⚠ 1 change needs attention")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^To Bar, 1 item, Not sent yet, needs attention/ })).toBeTruthy();
    vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === "Discard")?.onPress?.());
    press("Discard");
    await waitFor(() => expect(screen.queryByText(/Cannot send/)).toBeNull());
  });

  it("says it is offline with no signal (the store keeps the last download: transferStore.test.ts)", async () => {
    await makeStoreRoom({ readsFail: new ApiError("network") });
    render(<Transfers />);
    expect(screen.getByText(/You're offline/)).toBeTruthy();
  });
});

describe("a new transfer", () => {
  it("sends picked items to the chosen location through the queue, showing what this location has", async () => {
    const { request, outbox } = await makeStoreRoom();
    render(<TransferNew />);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Going to" })).getByRole("radio", { name: "Bar" }));
    type("Add an item", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    expect(screen.getByText("You have 1 L")).toBeTruthy();
    type("How much Gin, in L", "4");
    press("Send now");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
    await outbox.drain();
    expect(request.mock.calls.map((c) => [c[0], c[1]])).toEqual([["POST", "/api/inventory/transfers"], ["POST", "/api/inventory/transfers/00000000-0000-4000-8000-000000000001/send"]]);
    expect(request.mock.calls[0][2]).toEqual({ body: { transferId: "00000000-0000-4000-8000-000000000001", fromLocationId: "L1", toLocationId: "L2", lines: [{ ingredientId: "i1", sentQty: 4, sentUnit: "L" }] } });
  });

  it("shows a dash, not zero, where the quantity is hidden (blind count), and still lets the line go", async () => {
    signIn(["inventory:count", "inventory:manage"]);
    const { rows } = await makeStoreRoom({ canSeeQty: false, items: [item({ currentQty: 3 })] });
    render(<TransferNew />);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Going to" })).getByRole("radio", { name: "Bar" }));
    type("Add an item", "gin");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Gin" })).toBeTruthy());
    press("Use Gin");
    expect(screen.getByText("You have —")).toBeTruthy();
    type("How much Gin, in L", "40");
    press("Save, send later");
    await waitFor(() => expect(rows.size).toBe(1));
  });

  it("will not save without a destination or an item, and says why", async () => {
    await makeStoreRoom();
    render(<TransferNew />);
    press("Send now");
    expect(await screen.findByText("Choose where it's going.")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Going to" })).getByRole("radio", { name: "Bar" }));
    press("Send now");
    expect(await screen.findByText("Add at least one item.")).toBeTruthy();
  });

  it("explains when there is nowhere to send to, or the person may not make transfers", async () => {
    signIn(["inventory:count", "inventory:manage"], [main]);
    await makeStoreRoom();
    render(<TransferNew />);
    expect(screen.getByText(/There is no other location to send stock to/)).toBeTruthy();
    cleanup();
    signIn(["inventory:count"]);
    render(<TransferNew />);
    expect(screen.getByText(/Ask a manager to send it/)).toBeTruthy();
  });
});

describe("one transfer", () => {
  const due = transfer({ transferId: "due", fromLocationId: "L2", toLocationId: "L1", fromLocationName: "Bar", toLocationName: "Main Kitchen", status: "SENT", lineCount: 2 });
  const dueDetail = detailOf(due, [line(), line({ lineId: "l2", ingredientId: "i3", ingredientName: "Salt", sentQty: 1.5, sentUnit: "kg" })]);

  it("receives line by line: each starts at what was sent, a difference is named, and the receive is queued", async () => {
    searchParams.current = { transferId: "due" };
    const { request, outbox } = await makeStoreRoom({ transfers: [due], details: { due: dueDetail } });
    render(<TransferScreen />);
    expect(await screen.findByText("What arrived")).toBeTruthy();
    expect((screen.getByLabelText("Gin received, in L") as HTMLInputElement).value).toBe("2");
    type("Salt received, in kg", "1");
    expect(screen.getByText("Short by 0.5 kg")).toBeTruthy();
    expect(screen.getByText(/One item differs from what was sent/)).toBeTruthy();
    press("Confirm received");
    await waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/transfers/due/receive", { body: { receivedLines: [{ lineId: "l1", receivedQty: 2 }, { lineId: "l2", receivedQty: 1 }] } });
  });

  it("refuses a quantity below 0 on its line and queues nothing", async () => {
    searchParams.current = { transferId: "due" };
    const { rows } = await makeStoreRoom({ transfers: [due], details: { due: dueDetail } });
    render(<TransferScreen />);
    await screen.findByText("What arrived");
    type("Gin received, in L", "-2");
    press("Confirm received");
    expect(await screen.findByText("Enter what arrived: 0 or more.")).toBeTruthy();
    expect(rows.size).toBe(0);
  });

  it("offers send and cancel on a transfer from here to a manager, and asks before cancelling", async () => {
    searchParams.current = { transferId: "t1" };
    const { rows } = await makeStoreRoom({ transfers: [transfer()], details: { t1: detailOf(transfer(), [line()]) } });
    render(<TransferScreen />);
    expect(await screen.findByText("Sent 2 L")).toBeTruthy();
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === "Cancel transfer")?.onPress?.());
    press("Cancel transfer");
    expect(alert).toHaveBeenCalledWith("Cancel this transfer?", expect.stringContaining("Nothing leaves Main Kitchen"), expect.anything());
    await waitFor(() => expect([...rows.values()].map((r) => r.type)).toEqual(["transfer.cancel"]));
  });

  it("tells someone who may not send that a manager does it", async () => {
    signIn(["inventory:count"]);
    searchParams.current = { transferId: "t1" };
    await makeStoreRoom({ transfers: [transfer()], details: { t1: detailOf(transfer(), [line()]) } });
    render(<TransferScreen />);
    expect(await screen.findByText("A manager sends or cancels this transfer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
  });

  it("shows a transfer saved on this phone from its own lines, and can still send it", async () => {
    searchParams.current = { transferId: "00000000-0000-4000-8000-000000000001" };
    const { transfers, rows } = await makeStoreRoom();
    await transfers.create({ toLocationId: "L2", toLocationName: "Bar", lines: [{ ingredientId: "i1", ingredientName: "Gin", unit: "L", quantity: "3" }], notes: "", sendNow: false });
    render(<TransferScreen />);
    expect(await screen.findByText("Sent 3 L")).toBeTruthy();
    press("Send now");
    await waitFor(() => expect([...rows.values()].map((r) => r.type)).toEqual(["transfer.create", "transfer.send"]));
  });

  it("says when a transfer was never opened on this phone and there is no signal", async () => {
    searchParams.current = { transferId: "due" };
    await makeStoreRoom({ readsFail: new ApiError("network") });
    render(<TransferScreen />);
    expect(await screen.findByText(/has not been opened on this phone before/)).toBeTruthy();
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts the transfer screens in the app's 560 dp column, centred, on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    searchParams.current = { transferId: "t1" };
    await makeStoreRoom({ transfers: [transfer()], details: { t1: detailOf(transfer(), [line()]) } });
    for (const Screen of [Transfers, TransferNew, TransferScreen]) {
      const { container, unmount } = render(<Screen />);
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px");
      expect(column, "a 560 dp column").toBeTruthy();
      expect(getComputedStyle(column!).alignSelf).toBe("center");
      unmount();
    }
  });
});
