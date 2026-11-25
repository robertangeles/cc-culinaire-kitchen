// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Alert } from "react-native";
import { returnToScreen, routerMock, searchParams } from "../testing/mocks";
import { ApiError } from "../src/api/client";
import { COLUMN_WIDTH } from "../src/ui/Screen";
import { admin, api, detail, discrepancy, main, memoryKv, order, ordersFor, person, resetApi } from "./ordersHarness";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { useSession: () => sessionState.current, client: {} };
});
vi.mock("../src/storage/kv", () => ({ sqliteKv: {} }));

import Orders from "../app/(app)/(orders)/index";
import Order from "../app/(app)/(orders)/order";
import Approvals from "../app/(app)/(orders)/approvals";
import CreditNotes from "../app/(app)/(orders)/credit-notes";
import CreditNoteEntry from "../app/(app)/(orders)/credit-note-entry";

const offline = () => new ApiError("network");
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const find = (name: string | RegExp) => screen.findByRole("button", { name });
/** Answers the next confirmation by pressing the button with this label. */
const answer = (label: string) =>
  vi.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons) => buttons?.find((b) => b.text === label)?.onPress?.());
function cappedColumn(from: HTMLElement): boolean {
  for (let el: HTMLElement | null = from; el; el = el.parentElement) if (el.style.maxWidth === `${COLUMN_WIDTH}px` && el.style.alignSelf === "center") return true;
  return false;
}

beforeEach(() => {
  resetApi();
  searchParams.current = { poId: "P1" };
});

describe("the orders list", () => {
  it("shows this location's orders: supplier, number, items, status and total", async () => {
    render(<Orders />, ordersFor(admin));
    const row = await find(/^Fresh Farms, order PO-100, Draft, 1 item, \$35\.00/);
    expect(row).toBeTruthy();
    expect(screen.getByText("PO-100 · 1 item")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(main.storeLocationId, [], 0);
    fireEvent.click(row);
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/order", params: { poId: "P1" } });
  });

  it("shows no total where the server sent none", async () => {
    api.list.mockResolvedValue([order({ totalValue: undefined })]);
    render(<Orders />, ordersFor(admin));
    await screen.findByText("Fresh Farms");
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("filters by status on the server", async () => {
    render(<Orders />, ordersFor(admin));
    await screen.findByText("Fresh Farms");
    api.list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("radio", { name: "Received" }));
    expect(await screen.findByText("Nothing here")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("L1", ["RECEIVED", "PARTIAL_RECEIVED"], 0);
  });

  it("with no signal shows the last list, says when it is from and that changes need a connection, and tries again", async () => {
    const kv = memoryKv();
    const first = render(<Orders />, ordersFor(admin, kv));
    await screen.findByText("Fresh Farms");
    first.unmount();
    api.list.mockRejectedValue(offline());
    render(<Orders />, ordersFor(admin, kv));
    expect(await screen.findByText(/This is the list from .* Changes need a connection\./)).toBeTruthy();
    expect(screen.getByText("Fresh Farms")).toBeTruthy();
    api.list.mockResolvedValue([order({ supplierName: "Dairy Co" })]);
    fireEvent.click(button("Try again"));
    expect(await screen.findByText("Dairy Co")).toBeTruthy();
    expect(screen.queryByText(/This is the list from/)).toBeNull();
  });

  it("reads the list again on coming back to it", async () => {
    render(<Orders />, ordersFor(admin));
    await screen.findByText("Fresh Farms");
    api.list.mockResolvedValue([order({ status: "SENT" })]);
    act(() => returnToScreen());
    expect(await find(/PO-100, Sent/)).toBeTruthy();
  });

  it("says so in a card when there are none", async () => {
    api.list.mockResolvedValue([]);
    render(<Orders />, ordersFor(admin));
    expect(await screen.findByText("No orders yet")).toBeTruthy();
  });

  it("offers New order, Approvals and Credit notes only to the people the server lets do them", async () => {
    render(<Orders />, ordersFor(person(["inventory:count", "purchasing:draft", "purchasing:receive"])));
    await screen.findByText("Fresh Farms");
    expect(screen.queryByRole("button", { name: "New order" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Approvals/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Credit notes/ })).toBeNull();
    expect(api.discrepancies).not.toHaveBeenCalled();
  });

  it("counts what waits for an approver and what can be claimed", async () => {
    api.list.mockImplementation(async (_l: string, statuses: string[]) => (statuses[0] === "PENDING_APPROVAL" ? [order({ status: "PENDING_APPROVAL" }), order({ poId: "P2", status: "PENDING_APPROVAL" })] : []));
    api.discrepancies.mockResolvedValue([discrepancy()]);
    render(<Orders />, ordersFor(admin));
    expect(await find("Approvals, 2 waiting")).toBeTruthy();
    fireEvent.click(await find("Credit notes, 1 to claim"));
    expect(routerMock.push).toHaveBeenCalledWith("/credit-notes");
  });

  it("gives a person who may only raise credit notes just that, without asking for a list the server refuses them", async () => {
    render(<Orders />, ordersFor(person(["purchasing:credit"])));
    await find("Credit notes");
    expect(api.list).not.toHaveBeenCalled();
    expect(screen.queryByText("Show")).toBeNull();
  });

  it("keeps to the column on an iPad", async () => {
    render(<Orders />, ordersFor(admin));
    expect(cappedColumn(await screen.findByText("Fresh Farms"))).toBe(true);
  });
});

describe("one order", () => {
  it("shows its items with the prices the server sent", async () => {
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText("Flour")).toBeTruthy();
    expect(screen.getByText("2 bag")).toBeTruthy();
    expect(screen.getByText("$17.50 per bag")).toBeTruthy();
    expect(screen.getByText("$35.00")).toBeTruthy();
    expect(cappedColumn(screen.getByText("Flour"))).toBe(true);
  });

  it("shows no price and no total where the server sent none", async () => {
    api.detail.mockResolvedValue(detail({ totalValue: undefined }, { unitCost: undefined }));
    render(<Order />, ordersFor(admin));
    await screen.findByText("Flour");
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("submits a draft and says whether it was sent or needs approval", async () => {
    render(<Order />, ordersFor(admin));
    api.submit.mockResolvedValue({ poId: "P1", status: "PENDING_APPROVAL" });
    fireEvent.click(await find("Submit order"));
    api.detail.mockResolvedValue(detail({ status: "PENDING_APPROVAL" }));
    expect(await screen.findByText("This order needs approval first. The approvers have been told.")).toBeTruthy();
    expect(screen.getByText("Pending approval")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit order" })).toBeNull();
  });

  it("does one thing once, however fast it is tapped", async () => {
    let finish!: (v: unknown) => void;
    api.submit.mockReturnValue(new Promise((r) => (finish = r)));
    render(<Order />, ordersFor(admin));
    const b = await find("Submit order");
    // Both in one batch, so the second sees the screen as it was before the first.
    act(() => {
      b.click();
      b.click();
    });
    await act(async () => finish({ poId: "P1", status: "SENT" }));
    expect(api.submit).toHaveBeenCalledTimes(1);
  });

  it("with no signal says the action needs a connection and leaves the order as it was", async () => {
    api.submit.mockRejectedValue(offline());
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Submit order"));
    expect(await screen.findByText("Can't reach the server. Submitting an order needs a connection.")).toBeTruthy();
    expect(button("Submit order")).toBeTruthy();
  });

  it("whose answer was lost counts as done when the order shows it was", async () => {
    api.submit.mockRejectedValue(new ApiError("timeout"));
    render(<Order />, ordersFor(admin));
    const b = await find("Submit order");
    api.detail.mockResolvedValue(detail({ status: "SENT" }));
    fireEvent.click(b);
    expect(await screen.findByText("Sent")).toBeTruthy();
    expect(screen.queryByText(/took too long/)).toBeNull();
  });

  it("that moved on elsewhere shows how it stands now", async () => {
    api.submit.mockRejectedValue(new ApiError("conflict", "Cannot transition purchase order from CANCELLED to SENT", 409, undefined, "INVALID_STATE"));
    render(<Order />, ordersFor(admin));
    const b = await find("Submit order");
    api.detail.mockResolvedValue(detail({ status: "CANCELLED" }));
    fireEvent.click(b);
    expect(await screen.findByText("This order has changed since you opened it. Here is how it stands now.")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("that is a draft can be changed", async () => {
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Change order"));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/order-edit", params: { poId: "P1" } });
  });

  it("is cancelled only after a yes", async () => {
    render(<Order />, ordersFor(admin));
    answer("Go back");
    fireEvent.click(await find("Cancel order"));
    expect(api.cancel).not.toHaveBeenCalled();
    answer("Cancel order");
    api.detail.mockResolvedValue(detail({ status: "CANCELLED" }));
    fireEvent.click(button("Cancel order"));
    expect(await screen.findByText("Order cancelled.")).toBeTruthy();
  });

  it("shows why it was not approved, back in draft", async () => {
    api.detail.mockResolvedValue(detail({ rejectedReason: "Too much flour" }));
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText("Too much flour")).toBeTruthy();
  });

  it("opened with no signal shows what the list knew, no buttons that need the server, and gets the rest later", async () => {
    const kv = memoryKv();
    const env = ordersFor(admin, kv);
    await env.ctx.list("All").refresh();
    api.detail.mockRejectedValueOnce(offline());
    render(<Order />, env);
    expect(await screen.findByText("Can't reach the server. Try again. Changes need a connection.")).toBeTruthy();
    expect(screen.getByText("The items need a connection.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit order" })).toBeNull();
    fireEvent.click(button("Try again"));
    expect(await screen.findByText("Flour")).toBeTruthy();
    expect(button("Submit order")).toBeTruthy();
  });

  it("that cannot be opened at all says why and offers the way back", async () => {
    api.detail.mockRejectedValue(new ApiError("not_found", "Purchase order not found", 404));
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText("Purchase order not found")).toBeTruthy();
    fireEvent.click(button("Back to orders"));
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/(app)/(orders)");
  });

  it("opened from the inbox or a delivery leads to the list, not to a screen that may not be under it", async () => {
    searchParams.current = { poId: "P1", from: "link" };
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("All orders"));
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/(app)/(orders)");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("shows a message it was opened with", async () => {
    searchParams.current = { poId: "P1", notice: "Saved, but not submitted." };
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText("Saved, but not submitted.")).toBeTruthy();
  });

  it("that was sent links to its delivery, for the people who receive, and says who already has it open", async () => {
    api.detail.mockResolvedValue(detail({ status: "RECEIVING", beingReceivedBy: { userId: 9, userName: "Sam" } }));
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Receive delivery"));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/deliveries/[poId]", params: { poId: "P1" } });
    expect(screen.getByText("Sam is receiving this")).toBeTruthy();
  });

  it("is emailed to the supplier, with the server's reason when it is not", async () => {
    api.detail.mockResolvedValue(detail({ status: "SENT" }));
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Email to supplier"));
    expect(await screen.findByText("Emailed to orders@farms.test.")).toBeTruthy();
    api.email.mockResolvedValue({ emailed: false, to: null, message: "This supplier has no contact email on file." });
    fireEvent.click(button("Email to supplier"));
    expect(await screen.findByText("This supplier has no contact email on file.")).toBeTruthy();
  });

  it("once received shows who signed, what came, the price paid, and what can be claimed from the supplier", async () => {
    api.detail.mockResolvedValue(detail({ status: "PARTIAL_RECEIVED" }, { receivedQty: "1", actualUnitCost: "18", lineStatus: "SHORT", receivedDttm: "2026-11-21T01:00:00Z", receivedByUserName: "Sam" }));
    api.discrepancies.mockResolvedValue([discrepancy(), discrepancy({ discrepancyId: "d2", poId: "OTHER", ingredientName: "Milk" })]);
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText(/^Received by Sam on /)).toBeTruthy();
    expect(screen.getByText("Short, 1 received")).toBeTruthy();
    expect(screen.getByText(/paid \$18\.00/)).toBeTruthy();
    fireEvent.click(await find(/^Flour, Short: 2 kg missing of 5 kg, worth up to \$8\.00/));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/credit-note-entry", params: { discrepancyId: "d1", supplierId: "s1" } });
    expect(screen.queryByText("Milk")).toBeNull();
    expect(api.discrepancies).toHaveBeenCalledWith(0, "s1");
  });

  it("is ordered again into a new draft", async () => {
    api.detail.mockResolvedValue(detail({ status: "RECEIVED" }));
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Reorder"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/order", params: { poId: "P9" } }));
    expect(api.clone).toHaveBeenCalledWith("P1", "L1");
    api.clone.mockResolvedValue({ poId: "P9", poNumber: "PO-900", skippedItems: ["Salt"] });
    fireEvent.click(button("Reorder"));
    await waitFor(() => expect(routerMock.push).toHaveBeenLastCalledWith({ pathname: "/order", params: { poId: "P9", info: "1 item left out: already at or above par." } }));
  });
});

describe("approving", () => {
  beforeEach(() => {
    const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    api.list.mockResolvedValue([
      order({ poId: "new", poNumber: "PO-NEW", supplierName: "Dairy Co", status: "PENDING_APPROVAL", submittedAt: at(2), canApprove: true }),
      order({ poId: "P1", poNumber: "PO-OLD", status: "PENDING_APPROVAL", submittedAt: at(50), canApprove: false }),
    ]);
    api.detail.mockResolvedValue(detail({ status: "PENDING_APPROVAL", canApprove: true }));
  });

  it("lists what waits here, longest first, with how long and who asked", async () => {
    render(<Approvals />, ordersFor(admin));
    const rows = await screen.findAllByRole("button", { name: /order PO-/ });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([expect.stringContaining("PO-OLD"), expect.stringContaining("PO-NEW")]);
    expect(rows[0].getAttribute("aria-label")).toContain("Waiting 50 h");
    expect(screen.getAllByText("By Chef")).toHaveLength(2);
    expect(screen.getByText("You raised or changed this order, so another approver must approve it.")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("L1", ["PENDING_APPROVAL"], 0);
    expect(cappedColumn(screen.getByText("Dairy Co"))).toBe(true);
  });

  it("is an empty card when nothing waits, and nothing at all without the permission", async () => {
    api.list.mockResolvedValue([]);
    const first = render(<Approvals />, ordersFor(admin));
    expect(await screen.findByText("Nothing to approve")).toBeTruthy();
    first.unmount();
    api.list.mockClear();
    render(<Approvals />, ordersFor(person(["inventory:count", "purchasing:draft"])));
    expect(screen.getByText("You don't have permission to approve orders.")).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("approves after a yes", async () => {
    render(<Order />, ordersFor(admin));
    const asked = answer("Approve");
    const b = await find("Approve");
    api.detail.mockResolvedValue(detail({ status: "SENT" }));
    fireEvent.click(b);
    expect(await screen.findByText("Order approved. It is now marked as sent.")).toBeTruthy();
    expect(asked).toHaveBeenCalledWith("Approve PO-100?", "Fresh Farms, $35.00. It is marked as sent.", expect.anything());
    expect(api.approve).toHaveBeenCalledWith("P1");
  });

  it("offers no Approve on the approver's own order while the server says someone else must, but does offer Reject", async () => {
    api.detail.mockResolvedValue(detail({ status: "PENDING_APPROVAL", canApprove: false }));
    render(<Order />, ordersFor(admin));
    expect(await screen.findByText("You raised or changed this order, so another approver must approve it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(button("Reject")).toBeTruthy();
  });

  it("refused by the server shows its reason", async () => {
    api.approve.mockRejectedValue(new ApiError("forbidden", "You created this purchase order, so another approver must approve it.", 403, undefined, "SELF_APPROVAL_NOT_ALLOWED"));
    render(<Order />, ordersFor(admin));
    answer("Approve");
    fireEvent.click(await find("Approve"));
    expect(await screen.findByText("You created this purchase order, so another approver must approve it.")).toBeTruthy();
  });

  it("rejects only with a reason, and goes back to draft", async () => {
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Reject"));
    expect(button("Reject order").getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull(); // "Go back" is the one way out of the reason
    fireEvent.change(screen.getByLabelText("Why is it not approved?"), { target: { value: "  Too much flour " } });
    api.detail.mockResolvedValue(detail({ status: "DRAFT", rejectedReason: "Too much flour" }));
    fireEvent.click(button("Reject order"));
    expect(await screen.findByText("Order rejected. It is back in draft with your reason.")).toBeTruthy();
    expect(api.reject).toHaveBeenCalledWith("P1", "Too much flour");
    expect(screen.queryByLabelText("Why is it not approved?")).toBeNull();
  });

  it("keeps the typed reason when the rejection did not go through", async () => {
    api.reject.mockRejectedValue(offline());
    render(<Order />, ordersFor(admin));
    fireEvent.click(await find("Reject"));
    fireEvent.change(screen.getByLabelText("Why is it not approved?"), { target: { value: "Too much" } });
    fireEvent.click(button("Reject order"));
    expect(await screen.findByText("Can't reach the server. Rejecting an order needs a connection.")).toBeTruthy();
    expect((screen.getByLabelText("Why is it not approved?") as HTMLInputElement).value).toBe("Too much");
  });

  it("shows neither button to someone who does not approve", async () => {
    render(<Order />, ordersFor(person(["inventory:count", "purchasing:submit"])));
    await screen.findByText("Flour");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});

describe("credit notes", () => {
  it("lists what can be claimed, and explains a line with no price instead of opening it", async () => {
    api.discrepancies.mockResolvedValue([discrepancy(), discrepancy({ discrepancyId: "d2", ingredientName: "Milk", maxCreditAmount: null })]);
    render(<CreditNotes />, ordersFor(admin));
    fireEvent.click(await find(/^Flour/));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/credit-note-entry", params: { discrepancyId: "d1", supplierId: "s1" } });
    expect(screen.getByText("No price on this line, so a credit can't be checked against it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Milk/ })).toBeNull();
    expect(cappedColumn(screen.getByText("Flour"))).toBe(true);
  });

  it("lists the ones raised", async () => {
    api.creditNotes.mockResolvedValue([{ creditNoteId: "c1", discrepancyId: "d1", supplierId: "s1", creditAmount: 8, creditReference: "CN-77", notes: null, createdAt: "2026-11-22T00:00:00Z" }]);
    render(<CreditNotes />, ordersFor(admin));
    fireEvent.click(await screen.findByRole("tab", { name: "Raised" }));
    expect(await screen.findByText("CN-77")).toBeTruthy();
    expect(screen.getByText("$8.00")).toBeTruthy();
  });

  it("with no permission asks the server for nothing", () => {
    render(<CreditNotes />, ordersFor(person(["inventory:count", "purchasing:draft"])));
    expect(screen.getByText("You don't have permission to raise credit notes.")).toBeTruthy();
    expect(api.discrepancies).not.toHaveBeenCalled();
  });

  describe("raising one", () => {
    beforeEach(() => {
      searchParams.current = { discrepancyId: "d1", supplierId: "s1" };
      api.discrepancies.mockResolvedValue([discrepancy()]);
      api.credit.mockResolvedValue({ creditNoteId: "c1", discrepancyId: "d1", supplierId: "s1", creditAmount: 7.5, creditReference: null, notes: null, createdAt: null });
    });

    it("starts at what the server says it is worth, and sends what was typed with an id made on the phone", async () => {
      render(<CreditNoteEntry />, ordersFor(admin));
      const field = (await screen.findByLabelText("Amount credited")) as HTMLInputElement;
      expect(field.value).toBe("8.00");
      fireEvent.change(field, { target: { value: "7.50" } });
      fireEvent.change(screen.getByLabelText("Supplier's reference (optional)"), { target: { value: " CN-77 " } });
      fireEvent.click(button("Raise credit note"));
      expect(await screen.findByText("Credit note raised")).toBeTruthy();
      expect(api.credit).toHaveBeenCalledWith({ creditNoteId: expect.stringMatching(/^[0-9a-f-]{36}$/), discrepancyId: "d1", creditAmount: 7.5, creditReference: "CN-77" });
      fireEvent.click(button("Done"));
      expect(routerMock.back).toHaveBeenCalled();
    });

    it("refuses more than it is worth without a call", async () => {
      render(<CreditNoteEntry />, ordersFor(admin));
      fireEvent.change(await screen.findByLabelText("Amount credited"), { target: { value: "8.01" } });
      fireEvent.click(button("Raise credit note"));
      expect(await screen.findByText("The credit can't be more than $8.00, what this is worth.")).toBeTruthy();
      expect(api.credit).not.toHaveBeenCalled();
    });

    it("tries again with the same id after a lost reply, and says that is safe", async () => {
      api.credit.mockRejectedValueOnce(offline());
      render(<CreditNoteEntry />, ordersFor(admin));
      fireEvent.click(await find("Raise credit note"));
      expect(await screen.findByText(/Raising a credit note needs a connection\. It is safe to try again/)).toBeTruthy();
      fireEvent.click(button("Raise credit note"));
      await screen.findByText("Credit note raised");
      const [first, second] = api.credit.mock.calls.map((c) => c[0].creditNoteId);
      expect(second).toBe(first);
    });

    it("says so when someone else already raised it, and shows the server's other refusals", async () => {
      api.credit.mockRejectedValueOnce(new ApiError("bad_request", "The credit cannot be more than 6.00, what this discrepancy is worth", 400, undefined, "CREDIT_EXCEEDS_DISCREPANCY"));
      render(<CreditNoteEntry />, ordersFor(admin));
      fireEvent.click(await find("Raise credit note"));
      expect(await screen.findByText("The credit cannot be more than 6.00, what this discrepancy is worth")).toBeTruthy();
      api.credit.mockRejectedValueOnce(new ApiError("conflict", "x", 409, undefined, "ALREADY_CREDITED"));
      fireEvent.click(button("Raise credit note"));
      expect(await screen.findByText("Already credited")).toBeTruthy();
    });

    it("that is no longer open says it may already have one", async () => {
      api.discrepancies.mockResolvedValue([]);
      render(<CreditNoteEntry />, ordersFor(admin));
      expect(await screen.findByText("This was not found. It may already have a credit note.")).toBeTruthy();
    });

    it("links to its order", async () => {
      render(<CreditNoteEntry />, ordersFor(admin));
      fireEvent.click(await find("See order PO-100"));
      expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/order", params: { poId: "P1" } });
    });
  });
});
