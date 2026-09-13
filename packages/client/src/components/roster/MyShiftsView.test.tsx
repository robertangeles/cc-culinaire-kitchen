import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/** The role for each shift should be visible above its date/time, not just implied. */

const mockShifts = [
  {
    shiftId: "shift-1",
    assignmentId: "assign-1",
    storeLocationId: "loc-1",
    rosterRoleId: "role-1",
    roleName: "Bartender",
    startDatetime: "2027-03-01T09:00:00.000Z",
    endDatetime: "2027-03-01T17:00:00.000Z",
    status: "Published",
    assignmentStatus: "Confirmed" as const,
    publicHolidayConsent: null,
  },
];

vi.mock("../../hooks/useRoster.js", () => ({
  useMyShifts: () => ({
    shifts: mockShifts,
    isLoading: false,
    error: null,
    respond: vi.fn(),
    respondToConsentRequest: vi.fn(),
  }),
}));

vi.mock("../../hooks/useWorkforce.js", () => ({
  useShiftSwaps: () => ({ swaps: [], isLoading: false, offer: vi.fn(), claim: vi.fn(), cancel: vi.fn() }),
}));

vi.mock("../../context/AuthContext.js", () => ({
  useAuth: () => ({ user: { userId: 1 } }),
}));

const { MyShiftsView } = await import("./MyShiftsView.js");

describe("MyShiftsView — role name above date/time", () => {
  it("shows the shift's role name", () => {
    render(<MyShiftsView />);
    expect(screen.getByText("Bartender")).toBeInTheDocument();
  });
});
