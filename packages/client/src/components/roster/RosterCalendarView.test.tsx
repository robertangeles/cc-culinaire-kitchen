import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mondayOfWeek, addDaysIso } from "../../lib/rosterCalendarMath.js";

/**
 * A shift spanning multiple calendar days renders once, in its start day's
 * lane, sized to only that day's minutes (see RosterCalendarView's own
 * comment on this) — with no visual sign the shift actually continues past
 * that day unless the "+Nd" badge added here is present. This is what would
 * have made the 129h/157h incident shifts visually obvious on the calendar
 * instead of looking like ordinary single-day shifts.
 */

const weekStartIso = mondayOfWeek(new Date().toISOString().slice(0, 10));

// Local-constructor, not a raw "...Z" string: this component's day math is
// explicitly browser-local (see rosterCalendarMath's own module doc), so an
// ISO string anchored to UTC can silently roll onto a different local day
// depending on the test runner's timezone — the exact bug class this badge
// exists to catch, now in fixture form if built the wrong way.
function localIso(dayIso: string, hour: number): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
}

function calendarShift(overrides: Partial<{ shiftId: string; startDatetime: string; endDatetime: string }>) {
  return {
    shiftId: "shift-1",
    rosterRoleId: "role-1",
    roleName: "Duty Manager",
    startDatetime: localIso(weekStartIso, 8),
    endDatetime: localIso(weekStartIso, 17),
    status: "Draft" as const,
    isPublicHoliday: false,
    assignments: [],
    ...overrides,
  };
}

let mockCalendarShifts: ReturnType<typeof calendarShift>[] = [];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({
    locations: [{ storeLocationId: "loc-1", organisationId: 1 }],
    selectedLocationId: "loc-1",
  }),
}));

vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => () => true,
}));

vi.mock("../../hooks/useRoster.js", () => ({
  useRosterRoles: () => ({ roles: [{ rosterRoleId: "role-1", roleName: "Duty Manager", storeLocationId: null }] }),
  useOrgMembers: () => ({ members: [] }),
  useRosterCalendar: () => ({
    calendarShifts: mockCalendarShifts,
    isLoading: false,
    error: null,
    create: vi.fn(),
    updateTime: vi.fn(),
    assign: vi.fn(),
  }),
}));

const { RosterCalendarView } = await import("./RosterCalendarView.js");

describe("RosterCalendarView multi-day shift badge", () => {
  it("shows a +Nd badge for a shift spanning multiple calendar days", () => {
    // Mon 8am -> the following Sunday 9pm: 6 local days after its start day.
    mockCalendarShifts = [
      calendarShift({
        startDatetime: localIso(weekStartIso, 8),
        endDatetime: localIso(addDaysIso(weekStartIso, 6), 21),
      }),
    ];
    render(<RosterCalendarView />);
    expect(screen.getByText("+6d")).toBeInTheDocument();
  });

  it("shows no badge for a normal same-day shift", () => {
    mockCalendarShifts = [calendarShift({})];
    render(<RosterCalendarView />);
    expect(screen.queryByText(/^\+\d+d$/)).not.toBeInTheDocument();
  });

  it("regression: an overnight shift renders its real height instead of collapsing to the 18px floor", () => {
    // 10pm -> 2am: storedEndMinutes (120) is less than storedStartMinutes
    // (1320) once both are stripped to minutes-since-midnight, which used to
    // make `endMinutes - startMinutes` negative and collapse the block to
    // its Math.max(18, ...) floor — an ordinary overnight shift rendered as
    // a near-invisible sliver. It should now render from 10pm down to the
    // bottom of the visible day: (24*60 - 22*60) = 120 minutes = 96px at
    // this test's HOUR_HEIGHT (48px/hour), and still carry the "+1d" badge
    // since it does end on the following calendar day.
    mockCalendarShifts = [
      calendarShift({
        startDatetime: localIso(weekStartIso, 22),
        endDatetime: localIso(addDaysIso(weekStartIso, 1), 2),
      }),
    ];
    render(<RosterCalendarView />);
    expect(screen.getByText("+1d")).toBeInTheDocument();
    const block = document.querySelector('[data-shift-id="shift-1"]') as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.style.height).toBe("96px");
  });
});
