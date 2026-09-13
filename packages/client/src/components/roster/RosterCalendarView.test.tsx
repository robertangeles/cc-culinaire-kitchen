import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const mockUpdateTime = vi.fn();

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
    updateTime: mockUpdateTime,
    assign: vi.fn(),
  }),
}));

const { RosterCalendarView } = await import("./RosterCalendarView.js");

describe("RosterCalendarView multi-day shift badge", () => {
  beforeEach(() => {
    mockUpdateTime.mockClear();
  });

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

  it("refuses to drag (resize or move) an overnight/multi-day shift instead of silently corrupting its stored time", () => {
    // The component's own comment used to claim overnight/multi-day shifts
    // were "already disclosed as undraggable" — they weren't; a drag's start
    // guard only checked canManage/isDraft, so a resize/move on one of these
    // could silently rewrite its stored time using time-of-day-only minutes
    // that discard which calendar day the end actually falls on.
    mockCalendarShifts = [
      calendarShift({
        startDatetime: localIso(weekStartIso, 22),
        endDatetime: localIso(addDaysIso(weekStartIso, 1), 2),
      }),
    ];
    render(<RosterCalendarView />);
    const block = document.querySelector('[data-shift-id="shift-1"]') as HTMLElement;
    expect(block).toBeTruthy();

    // jsdom has no layout engine (elementFromPoint doesn't exist), so this
    // only exercises the gesture's start guard, not a real pointer move —
    // sufficient here since the guard's whole job is to refuse the drag
    // before beginDrag() ever attaches a listener for it.
    fireEvent.pointerDown(block, { clientY: 5 });
    fireEvent.pointerUp(window);

    expect(mockUpdateTime).not.toHaveBeenCalled();
  });

  it("role-legend border colors are literal Tailwind classes, not built via runtime string replacement", () => {
    // Tailwind's JIT scanner only generates CSS for class names it can find
    // as literal text in source — a runtime .replace("border-l-", "border-")
    // produces a JS string that looks correct but was never scanned, so its
    // CSS rule is silently missing from the production bundle. Confirmed
    // against the actual built CSS during review: 6 of 8 role colors had no
    // border in production.
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "./RosterCalendarView.tsx"), "utf-8");
    expect(source).not.toMatch(/\.replace\(\s*["'`]border-l-/);
    for (const color of ["rose", "amber", "emerald", "cyan", "blue", "violet", "fuchsia", "teal"]) {
      expect(source).toContain(`border-${color}-500`);
    }
  });

  it("scrolling the hour rail moves the day columns (and their shift blocks) with it", () => {
    mockCalendarShifts = [calendarShift({})];
    render(<RosterCalendarView />);

    const hourRail = document.getElementById("roster-calendar-hour-rail") as HTMLElement;
    const dayColumn = document.querySelector('[data-day-iso][data-role-id]')!.closest(
      "div.overflow-y-hidden",
    ) as HTMLElement;
    expect(hourRail).toBeTruthy();
    expect(dayColumn).toBeTruthy();

    // The hour rail is the only element overflow lets a real scroll gesture
    // land on (day columns are overflow-y-hidden by design, to avoid seven
    // visible scrollbars) — so this is the scroll a user's wheel/touch
    // actually produces. Before the fix, day columns had no way to hear it:
    // their own onScroll only fires from a scroll THEY receive, which
    // overflow:hidden makes impossible, so shift blocks stayed frozen at
    // the mount-time scrollTop no matter how far the hour rail scrolled.
    hourRail.scrollTop = 300;
    fireEvent.scroll(hourRail);

    expect(dayColumn.scrollTop).toBe(300);
  });

  it("a shift block's hover info is the shared rectangular Tooltip, not a native title attribute", async () => {
    // A native `title` tooltip can't be styled and often renders as one
    // wide unwrapped line — the reported complaint. Uses the shared,
    // width-capped Tooltip component (see components/ui/Tooltip.tsx)
    // instead, so the same info wraps into a proper rectangle.
    mockCalendarShifts = [calendarShift({})];
    render(<RosterCalendarView />);
    const block = document.querySelector('[data-shift-id="shift-1"]') as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.getAttribute("title")).toBeNull();

    // The Tooltip component's own hover-trigger wrapper — the immediate
    // child of the block — not `block` itself, since onMouseEnter is bound
    // there, not on `block`.
    const tooltipTrigger = block.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(tooltipTrigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Duty Manager");
    expect(tooltip.textContent).toContain("Unassigned");
  });
});
