import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Expiry date, lot number and docket number on the web receiving checklist. What matters: the expiry and lot
 * are saved without a status (so a rejected line stays rejected), a day before the delivery is refused before
 * anything is sent, and the docket number goes with the confirm.
 */

const { default: ReceivingChecklist } = await import("./ReceivingChecklist.js");

const startedAt = "2026-11-28T03:00:00.000Z";
const line = {
  receivingLineId: "rl-1", sessionId: "s-1", poLineId: "pl-1", ingredientId: "i-1",
  orderedQty: "5", orderedUnit: "kg", receivedQty: "0", actualUnitCost: "2", status: "REJECTED",
  expiryDate: null, lotNumber: null,
  ingredientName: "Flour", ingredientCategory: "dry_goods", baseUnit: "kg", parLevel: null, stockOnHand: null,
};
const po = { poId: "po-1", poNumber: "PO-1", storeLocationId: "loc-1", supplierName: "Mill" } as never;

const calls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const json = (data: unknown) => ({ ok: true, json: async () => data });
    if (url.endsWith("/receiving/sessions")) {
      return json({ session: { sessionId: "s-1", poId: "po-1", startedAt, docketNumber: null }, lines: [line], discrepancies: [], photos: [] });
    }
    if (url.includes("/lines/")) return json({ line: { ...line, ...body }, discrepancy: null });
    return json({ sessionId: "s-1", poId: "po-1", poStatus: "PARTIAL_RECEIVED", linesProcessed: 0, discrepancyCount: 1, isPerfectDelivery: false, docketNumber: body?.docketNumber ?? null });
  }));
});

async function openDetails() {
  render(<ReceivingChecklist po={po} onBack={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Expiry & Lot" }));
}

describe("ReceivingChecklist expiry, lot and docket", () => {
  it("saves the expiry and lot without a status and shows them on the line", async () => {
    await openDetails();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-12-05" } });
    fireEvent.change(screen.getByLabelText("Lot number"), { target: { value: " L-42 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Expiry & Lot" }));

    await screen.findByText("· Lot L-42");
    expect(screen.getByText("· Use by 5 December 2026")).toBeTruthy();
    expect(calls.find((c) => c.url.includes("/lines/"))?.body).toEqual({ expiryDate: "2026-12-05", lotNumber: "L-42" });
  });

  it("refuses an expiry before the delivery day and sends nothing", async () => {
    await openDetails();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Expiry & Lot" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The expiry date can't be before the delivery day.");
    expect(calls.some((c) => c.url.includes("/lines/"))).toBe(false);
  });

  it("confirms with the docket number, trimmed", async () => {
    render(<ReceivingChecklist po={po} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Supplier docket number"), { target: { value: " D-900 " } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Receipt/ }));

    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/confirm"))?.body).toEqual({ docketNumber: "D-900" }));
  });
});
