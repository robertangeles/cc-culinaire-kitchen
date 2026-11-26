import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatShiftRange } from "@culinaire/shared";

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
    ianaTimezone: "Pacific/Chatham",
  },
];

/** A zone no test machine runs in, so venue time and browser time differ. */
const VENUE_ZONE = "Pacific/Chatham";
const SWAP = {
  swapRequestId: "swap-1",
  shiftId: "shift-2",
  fromAssignmentId: "assign-2",
  fromUserId: 2,
  fromUserName: "Sam",
  startDatetime: "2027-03-02T09:00:00.000Z",
  endDatetime: "2027-03-02T17:00:00.000Z",
  rosterRoleId: "role-1",
  roleName: "Bartender",
  storeLocationId: "loc-1",
  ianaTimezone: VENUE_ZONE,
};
const state = vi.hoisted(() => ({ shifts: [] as unknown[], swaps: [] as unknown[] }));
beforeEach(() => {
  state.shifts = mockShifts;
  state.swaps = [];
});

vi.mock("../../hooks/useRoster.js", () => ({
  useMyShifts: () => ({
    shifts: state.shifts,
    isLoading: false,
    error: null,
    respond: vi.fn(),
    respondToConsentRequest: vi.fn(),
  }),
}));

vi.mock("../../hooks/useWorkforce.js", () => ({
  useShiftSwaps: () => ({ swaps: state.swaps, isLoading: false, offer: vi.fn(), claim: vi.fn(), cancel: vi.fn() }),
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

describe("MyShiftsView — venue time and open swaps", () => {
  it("shows a shift in the venue's time zone, not the browser's", () => {
    const { startDatetime, endDatetime } = mockShifts[0];
    expect(formatShiftRange(startDatetime, endDatetime, VENUE_ZONE)).not.toBe(formatShiftRange(startDatetime, endDatetime));
    render(<MyShiftsView />);
    expect(screen.getByText(formatShiftRange(startDatetime, endDatetime, VENUE_ZONE))).toBeInTheDocument();
  });

  it("shows an open swap in its venue's time zone", () => {
    state.swaps = [SWAP];
    render(<MyShiftsView />);
    expect(screen.getByText(formatShiftRange(SWAP.startDatetime, SWAP.endDatetime, VENUE_ZONE))).toBeInTheDocument();
  });

  it("shows open swaps to a person with no shift of their own", () => {
    state.shifts = [];
    state.swaps = [SWAP];
    render(<MyShiftsView />);
    expect(screen.getByText("No shifts yet")).toBeInTheDocument();
    expect(screen.getByText("Open swaps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claim/ })).toBeInTheDocument();
  });
});
