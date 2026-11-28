import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Expiry date, lot number and docket number on the web receiving checklist. What matters: the expiry and lot
 * are saved without a status (so a rejected line stays rejected), a day before the delivery is refused before
 * anything is sent unless the line is rejected, and the docket number goes with the confirm.
 */

const { default: ReceivingChecklist } = await import("./ReceivingChecklist.js");

const startedAt = "2026-11-28T03:00:00.000Z";
const line = {
  receivingLineId: "rl-1", sessionId: "s-1", poLineId: "pl-1", ingredientId: "i-1",
  orderedQty: "5", orderedUnit: "kg", receivedQty: "0", actualUnitCost: "2", status: "RECEIVED",
  expiryDate: null, lotNumber: null,
  ingredientName: "Flour", ingredientCategory: "dry_goods", baseUnit: "kg", parLevel: null, stockOnHand: null,
};
const po = { poId: "po-1", poNumber: "PO-1", storeLocationId: "loc-1", supplierName: "Mill" } as never;

const calls: Array<{ url: string; body: unknown }> = [];
let lineReply: "ok" | "refused" | "unreachable" = "ok";
const refusal = "The expiry date has passed. Clear it to accept this line, or keep the line rejected.";

beforeEach(() => {
  calls.length = 0;
  line.status = "RECEIVED";
  lineReply = "ok";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const json = (data: unknown) => ({ ok: true, json: async () => data });
    if (url.endsWith("/receiving/sessions")) {
      return json({ session: { sessionId: "s-1", poId: "po-1", startedAt, docketNumber: null }, lines: [line], discrepancies: [], photos: [] });
    }
    if (url.includes("/lines/") && lineReply === "unreachable") throw new TypeError("Failed to fetch");
    if (url.includes("/lines/") && lineReply === "refused") {
      return { ok: false, status: 400, json: async () => ({ error: refusal, code: "EXPIRY_DATE_OUT_OF_RANGE" }) };
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

  it("saves an expiry before the delivery day on a rejected line", async () => {
    line.status = "REJECTED";
    await openDetails();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Expiry & Lot" }));

    await screen.findByText("· Use by 1 November 2026");
    expect(calls.find((c) => c.url.includes("/lines/"))?.body).toEqual({ expiryDate: "2026-11-01", lotNumber: null });
  });

  it("refuses an expiry before the delivery day on a received line and sends nothing", async () => {
    await openDetails();
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Expiry & Lot" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The expiry date has passed. Clear it to accept this line, or keep the line rejected.");
    expect(calls.some((c) => c.url.includes("/lines/"))).toBe(false);
  });

  it("puts a line back and shows the server's refusal, not the offline banner, when the server refuses the status change", async () => {
    line.status = "REJECTED";
    lineReply = "refused";
    render(<ReceivingChecklist po={po} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "All Good" }));

    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(screen.getByText(/· Rejected/)).toBeTruthy();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("keeps the change and shows the offline banner when the server cannot be reached", async () => {
    line.status = "REJECTED";
    lineReply = "unreachable";
    render(<ReceivingChecklist po={po} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "All Good" }));

    expect(await screen.findByText("Offline")).toBeTruthy();
    expect(screen.queryByText(/· Rejected/)).toBeNull();
  });

  it("confirms with the docket number, trimmed", async () => {
    render(<ReceivingChecklist po={po} onBack={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Supplier docket number"), { target: { value: " D-900 " } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm Receipt/ }));

    await waitFor(() => expect(calls.find((c) => c.url.endsWith("/confirm"))?.body).toEqual({ docketNumber: "D-900" }));
  });
});
