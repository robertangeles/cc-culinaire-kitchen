import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A purchase order line rendered "Draft" on an order that had already been
 * SENT. Line status is its own vocabulary (PENDING / PARTIAL / RECEIVED); it
 * was being looked up in the ORDER status map, missing every key, and falling
 * through to a hardcoded DRAFT default.
 *
 * On a document someone spends money against, a badge that silently claims the
 * opposite of the truth is worse than no badge. These lock both halves: the
 * right label per vocabulary, and an honest fallback for anything unmapped.
 */

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));
vi.mock("../../hooks/useInventory.js", () => ({
  usePurchaseOrders: () => ({ pos: [], isLoading: false, refresh: vi.fn() }),
  useLocationIngredients: () => ({ items: [], isLoading: false, refresh: vi.fn() }),
}));

const { StatusBadge } = await import("./PurchaseOrderList.js");

describe("StatusBadge", () => {
  it("does not call a PENDING line 'Draft'", () => {
    render(<StatusBadge status="PENDING" kind="line" />);
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.getByText("Awaiting delivery")).toBeTruthy();
  });

  it("labels the rest of the line vocabulary", () => {
    const { rerender } = render(<StatusBadge status="RECEIVED" kind="line" />);
    expect(screen.getByText("Received")).toBeTruthy();
    rerender(<StatusBadge status="PARTIAL" kind="line" />);
    expect(screen.getByText("Part received")).toBeTruthy();
  });

  it("still labels order statuses correctly", () => {
    const { rerender } = render(<StatusBadge status="SENT" />);
    expect(screen.getByText("Sent")).toBeTruthy();
    rerender(<StatusBadge status="DRAFT" />);
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("shows an unmapped status verbatim instead of inventing a label", () => {
    // The old fallback asserted "Draft" for anything it didn't recognise —
    // which is how a sent order got to claim it hadn't been sent.
    render(<StatusBadge status="SOME_NEW_STATUS" kind="line" />);
    expect(screen.getByText("SOME_NEW_STATUS")).toBeTruthy();
    expect(screen.queryByText("Draft")).toBeNull();
  });
});
