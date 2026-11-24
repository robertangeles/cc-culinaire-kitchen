import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ApprovalQueue from "./ApprovalQueue.js";

/**
 * Approval row layout at iPad width (768 to 1024 px).
 *
 * jsdom does no layout, so this pins the classes that stop the row from overlapping:
 * the row wraps so the amount and buttons drop under the details instead of squeezing
 * them, the details block keeps a floor width instead of collapsing to zero, and the
 * detail line wraps rather than overflowing into the amount. Losing any of them brings
 * back the overlap seen in the 768 px screenshot of this change.
 */

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));

vi.mock("../../hooks/useInventory.js", () => ({
  usePurchaseOrders: () => ({
    pos: [
      {
        poId: "po-1",
        status: "PENDING_APPROVAL",
        poNumber: "PO-2026-001",
        supplierName: "Metropolitan Fresh Produce & Provisions Co.",
        locationName: "Collingwood Flagship Kitchen",
        lineCount: 15,
        totalValue: "4938.00",
        submittedAt: new Date().toISOString(),
        createdByUserName: "Alexandra Papadopoulos",
        canApprove: true,
      },
    ],
    isLoading: false,
    approvePO: vi.fn(),
    rejectPO: vi.fn(),
  }),
}));

describe("ApprovalQueue row layout", () => {
  it("wraps the row, keeps a floor width on the details and wraps the detail line", () => {
    render(<ApprovalQueue />);

    const row = screen.getByText("PO-2026-001").closest("div.px-4.py-4") as HTMLElement;
    expect(row.className).toContain("flex-wrap");

    const details = screen.getByText("PO-2026-001").parentElement!.parentElement as HTMLElement;
    expect(details.className).toContain("min-w-[14rem]");
    expect(details.className).not.toContain("min-w-0");

    const detailLine = screen.getByText("Collingwood Flagship Kitchen").parentElement as HTMLElement;
    expect(detailLine.className).toContain("flex-wrap");

    const actions = screen.getByRole("button", { name: /Approve/ }).parentElement as HTMLElement;
    expect(actions.className).toContain("shrink-0");
    expect(actions.className).toContain("ml-auto");
  });
});
