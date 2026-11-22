// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Alert } from "react-native";
import { routerMock, searchParams, sessionState } from "../testing/mocks";
import { ApiError } from "../src/api/client";

const api = vi.hoisted(() => ({
  queue: vi.fn(),
  purchaseOrder: vi.fn(),
  startSession: vi.fn(),
  actionLine: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../src/runtime/receiving", () => ({ receivingApi: api }));
vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { useSession: () => sessionState.current };
});

import ReceiveQueue from "../app/receive/index";
import ReceiveDelivery from "../app/receive/[poId]";

const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["purchasing:receive"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

const queueItem = (over: object = {}) => ({
  poId: "P1", poNumber: "PO-100", status: "SENT", supplierName: "Fresh Farms", supplierPhone: "0400 111 222", lineCount: 2,
  expectedDeliveryDate: null, sentAt: null, storeLocationId: "L1", beingReceivedBy: null, ...over,
});
const line = (id: string, name: string, over: object = {}) => ({
  receivingLineId: id, ingredientId: `i-${id}`, ingredientName: name, orderedQty: "5.0000", orderedUnit: "kg",
  receivedQty: "5.0000", actualUnitCost: "2.0000", status: "RECEIVED", ...over,
});
const started = (over: object = {}) => ({
  session: { sessionId: "S1", poId: "P1", storeLocationId: "L1", receivedByUserId: 1, status: "ACTIVE" },
  lines: [line("r1", "Flour"), line("r2", "Tomatoes")],
  resumed: false,
  startedBy: { userId: 1, userName: "Chef" },
  ...over,
});

const key = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));
const type = (digits: string) => [...digits].forEach((d) => key(d));
const open = async (name: string) => fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name},`) }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionState.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  searchParams.current = { poId: "P1" };
  api.queue.mockResolvedValue([queueItem()]);
  api.purchaseOrder.mockResolvedValue({ poId: "P1", poNumber: "PO-100", status: "SENT", storeLocationId: "L1", supplierName: "Fresh Farms", supplierPhone: "0400 111 222", lines: [] });
  api.startSession.mockResolvedValue(started());
  api.actionLine.mockImplementation(async (_s: string, id: string, input: { status: string; receivedQty?: string; actualUnitCost?: string }) => ({
    receivingLineId: id, status: input.status, receivedQty: input.receivedQty ?? "5.0000", actualUnitCost: input.actualUnitCost ?? "2.0000",
  }));
  api.confirm.mockResolvedValue({ sessionId: "S1", poId: "P1", poStatus: "RECEIVED", linesProcessed: 2, discrepancyCount: 0, isPerfectDelivery: true });
});

describe("deliveries queue", () => {
  it("lists what is waiting, asking the server for this location only", async () => {
    render(<ReceiveQueue />);
    expect(await screen.findByText("Fresh Farms")).toBeTruthy();
    expect(screen.getByText("PO-100 · 2 items")).toBeTruthy();
    expect(api.queue).toHaveBeenCalledWith("L1");
  });

  it("opens a delivery when tapped", async () => {
    render(<ReceiveQueue />);
    fireEvent.click(await screen.findByRole("button", { name: /Fresh Farms/ }));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/receive/[poId]", params: { poId: "P1" } });
  });

  it("marks one that you already started, and one another chef has open", async () => {
    api.queue.mockResolvedValue([
      queueItem({ status: "RECEIVING", beingReceivedBy: { userId: 1, userName: "Chef", sessionId: "S1", startedAt: "" } }),
      queueItem({ poId: "P2", poNumber: "PO-200", supplierName: "Dairy Co", status: "RECEIVING", beingReceivedBy: { userId: 9, userName: "Sam", sessionId: "S9", startedAt: "" } }),
    ]);
    render(<ReceiveQueue />);
    expect(await screen.findByText("In progress")).toBeTruthy();
    expect(screen.getByText("Sam is receiving this")).toBeTruthy();
  });

  it("says so plainly when nothing is waiting", async () => {
    api.queue.mockResolvedValue([]);
    render(<ReceiveQueue />);
    expect(await screen.findByText("No deliveries waiting")).toBeTruthy();
  });

  it("shows the reason and a retry when the server cannot be reached", async () => {
    api.queue.mockRejectedValueOnce(new ApiError("network"));
    render(<ReceiveQueue />);
    expect(await screen.findByText("Can't reach the server. Try again.")).toBeTruthy();
    api.queue.mockResolvedValue([queueItem()]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fresh Farms")).toBeTruthy();
  });
});

describe("receiving a delivery", () => {
  it("a perfect delivery is: open, confirm", async () => {
    render(<ReceiveDelivery />);
    expect(await screen.findByText("Flour")).toBeTruthy();
    expect(api.startSession).toHaveBeenCalledWith("P1", "L1");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText("Delivery received")).toBeTruthy();
    expect(api.confirm).toHaveBeenCalledWith("S1");
    expect(api.actionLine).not.toHaveBeenCalled();
  });

  it("marks a line short through the keypad and shows what the server saved", async () => {
    render(<ReceiveDelivery />);
    await open("Flour");
    key("Short");
    type("3");
    fireEvent.click(screen.getByRole("button", { name: "Mark short" }));
    await waitFor(() => expect(api.actionLine).toHaveBeenCalledWith("S1", "r1", { status: "SHORT", receivedQty: "3" }));
    expect(await screen.findByText("Short: 3 of 5 kg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm delivery · 1 issue" })).toBeTruthy();
  });

  it("does not send a short quantity that is not less than the order", async () => {
    render(<ReceiveDelivery />);
    await open("Flour");
    key("Short");
    type("5");
    fireEvent.click(screen.getByRole("button", { name: "Mark short" }));
    expect(await screen.findByText("Short means less than the 5 kg ordered.")).toBeTruthy();
    expect(api.actionLine).not.toHaveBeenCalled();
  });

  it("records a wrong price", async () => {
    render(<ReceiveDelivery />);
    await open("Tomatoes");
    key("Wrong price");
    type("3");
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    await waitFor(() => expect(api.actionLine).toHaveBeenCalledWith("S1", "r2", { status: "PRICE_VARIANCE", actualUnitCost: "3" }));
    expect(await screen.findByText("5 kg, price now $3.00/kg")).toBeTruthy();
  });

  it("rejects an item with a reason", async () => {
    render(<ReceiveDelivery />);
    await open("Flour");
    key("Reject");
    fireEvent.click(screen.getByRole("radio", { name: "Damaged packaging" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject item" }));
    await waitFor(() => expect(api.actionLine).toHaveBeenCalledWith("S1", "r1", { status: "REJECTED", rejectionReason: "damaged" }));
  });

  it("All good on a short line sends the ordered quantity back", async () => {
    api.startSession.mockResolvedValue(started({ lines: [line("r1", "Flour", { status: "SHORT", receivedQty: "2.0000" })] }));
    render(<ReceiveDelivery />);
    await open("Flour");
    key("All good");
    await waitFor(() => expect(api.actionLine).toHaveBeenCalledWith("S1", "r1", { status: "RECEIVED", receivedQty: "5.0000" }));
  });

  it("when the server refuses a change it says why and leaves the line as it was", async () => {
    api.actionLine.mockRejectedValueOnce(new ApiError("bad_request", "Receiving session is no longer active", 400));
    render(<ReceiveDelivery />);
    await open("Flour");
    key("Reject");
    fireEvent.click(screen.getByRole("button", { name: "Reject item" }));
    expect(await screen.findByText("Receiving session is no longer active")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Flour, 5 kg, Received/ })).toBeTruthy();
  });

  it("will not confirm while a line is still saving", async () => {
    let finish!: (v: unknown) => void;
    api.actionLine.mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(<ReceiveDelivery />);
    await open("Flour");
    key("Reject");
    fireEvent.click(screen.getByRole("button", { name: "Reject item" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm delivery" }).getAttribute("aria-disabled")).toBe("true"));
    finish({ receivingLineId: "r1", status: "REJECTED", receivedQty: "0", actualUnitCost: "2" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm delivery · 1 issue" }).getAttribute("aria-disabled")).not.toBe("true"));
  });

  it("a short delivery ends with the order closed as partial", async () => {
    api.confirm.mockResolvedValue({ sessionId: "S1", poId: "P1", poStatus: "PARTIAL_RECEIVED", linesProcessed: 1, discrepancyCount: 1, isPerfectDelivery: false });
    render(<ReceiveDelivery />);
    await screen.findByText("Flour");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText("Delivery received, with a shortfall")).toBeTruthy();
    expect(screen.getByText(/new purchase order/)).toBeTruthy();
  });

  it("says so when the delivery was already confirmed (another phone, or a retry that landed)", async () => {
    api.confirm.mockRejectedValue(new ApiError("conflict", "Receiving session already confirmed", 409, { code: "ALREADY_CONFIRMED" }));
    render(<ReceiveDelivery />);
    await screen.findByText("Flour");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText("Already done")).toBeTruthy();
  });

  it("names the item when a unit cannot be converted, and keeps the delivery open", async () => {
    api.confirm.mockRejectedValue(new ApiError("bad_request", "Cannot receive Tomatoes (case to kg): no conversion.", 400, { code: "UNIT_NOT_CONVERTIBLE" }));
    render(<ReceiveDelivery />);
    await screen.findByText("Flour");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText(/Cannot receive Tomatoes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm delivery" })).toBeTruthy();
  });

  it("tells you when another phone started this delivery", async () => {
    api.startSession.mockResolvedValue(started({ resumed: true, startedBy: { userId: 9, userName: "Sam" } }));
    render(<ReceiveDelivery />);
    expect(await screen.findByText(/Sam started this delivery on another phone/)).toBeTruthy();
  });

  it("cancelling asks first, then discards the delivery and returns to the queue", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === "destructive")?.onPress?.());
    api.cancel.mockResolvedValue(undefined);
    render(<ReceiveDelivery />);
    await screen.findByText("Flour");
    fireEvent.click(screen.getByRole("button", { name: "Cancel receiving" }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("S1"));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/receive"));
    alert.mockRestore();
  });

  it("explains a delivery that cannot be opened and offers a retry", async () => {
    api.purchaseOrder.mockRejectedValueOnce(new ApiError("not_found"));
    render(<ReceiveDelivery />);
    expect(await screen.findByText("Couldn't open this delivery")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
