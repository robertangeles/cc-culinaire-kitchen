import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Opening a stock take by storage area from the web (mobile release 1, X1). The web only
 * OPENS an area count; chefs count it on the phone, so the active card shows status only.
 */

const openSession = vi.fn();
let mockSession: any = null;
const areas = [
  { storageAreaId: "a1", areaName: "Bar", sortOrder: 0, activeInd: true, itemCount: 4 },
  { storageAreaId: "a2", areaName: "Stock Room", sortOrder: 1, activeInd: true, itemCount: 6 },
  { storageAreaId: "a3", areaName: "Old Cellar", sortOrder: 2, activeInd: false, itemCount: 0 },
];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1" }),
}));
vi.mock("../../hooks/useStorageAreas.js", () => ({
  useStorageAreas: () => ({ areas, isLoading: false }),
}));
vi.mock("../../hooks/useInventory.js", () => ({
  useStockTake: () => ({
    session: mockSession, isLoading: false, openSession,
    claimCategory: vi.fn(), submitCategory: vi.fn(), getDetail: vi.fn(), submitForReview: vi.fn(),
  }),
}));
vi.mock("./CategoryCounter.js", () => ({ CategoryCounter: () => null }));

const { StockTakeSession } = await import("./StockTakeSession.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = null;
  openSession.mockResolvedValue({});
});

describe("StockTakeSession, count by area", () => {
  it("opens with every active area by default, sending no names so Unassigned is included", async () => {
    render(<StockTakeSession />);
    fireEvent.click(screen.getByText("Count by Area"));
    expect(screen.queryByText("Old Cellar")).toBeNull(); // inactive areas are not offered
    fireEvent.click(screen.getByText(/Start \(2\)/));
    await waitFor(() => expect(openSession).toHaveBeenCalledWith(undefined, "AREA"));
  });

  it("opens only the ticked areas by name", async () => {
    render(<StockTakeSession />);
    fireEvent.click(screen.getByText("Count by Area"));
    fireEvent.click(screen.getByLabelText("Stock Room")); // untick
    fireEvent.click(screen.getByText(/Start \(1\)/));
    await waitFor(() => expect(openSession).toHaveBeenCalledWith(["Bar"], "AREA"));
  });

  it("shows the server's closed-set message when areas that share an item are split", async () => {
    openSession.mockRejectedValue(new Error("Add Stock Room to this count: areas that share an item must be counted together"));
    render(<StockTakeSession />);
    fireEvent.click(screen.getByText("Count by Area"));
    fireEvent.click(screen.getByLabelText("Stock Room"));
    fireEvent.click(screen.getByText(/Start \(1\)/));
    expect(await screen.findByText(/Add Stock Room to this count/)).toBeTruthy();
  });

  it("disables Start when no area is ticked", () => {
    render(<StockTakeSession />);
    fireEvent.click(screen.getByText("Count by Area"));
    fireEvent.click(screen.getByLabelText("Bar"));
    fireEvent.click(screen.getByLabelText("Stock Room"));
    expect((screen.getByText(/Start \(0\)/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an active area count shows status only: no Start Counting, a phone-app note", () => {
    mockSession = {
      sessionId: "s1", sessionStatus: "OPEN", countMode: "AREA", openedDttm: "2026-11-18T00:00:00Z", categories: [
        { categoryId: "c1", sessionId: "s1", categoryName: "Bar", categoryStatus: "NOT_STARTED" },
        { categoryId: "c2", sessionId: "s1", categoryName: "Stock Room", categoryStatus: "IN_PROGRESS" },
      ],
    };
    render(<StockTakeSession />);
    expect(screen.getByText(/Count each area in the phone app/)).toBeTruthy();
    expect(screen.queryByText("Start Counting")).toBeNull();
    expect(screen.queryByText("Submit")).toBeNull();
  });

  it("an active category count still shows Start Counting", () => {
    mockSession = {
      sessionId: "s2", sessionStatus: "OPEN", countMode: "CATEGORY", openedDttm: "2026-11-18T00:00:00Z", categories: [
        { categoryId: "c1", sessionId: "s2", categoryName: "dairy", categoryStatus: "NOT_STARTED" },
      ],
    };
    render(<StockTakeSession />);
    expect(screen.getByText("Start Counting")).toBeTruthy();
  });
});
