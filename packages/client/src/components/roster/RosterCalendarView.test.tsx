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
function localIso(dayIso: string, hour: number, minute = 0): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).toISOString();
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

  it("a shift block's hover info follows the cursor via a fixed-position portal, not a native title attribute", () => {
    // A native `title` tooltip can't be styled (can't be capped to a
    // rectangle) and always anchors to the OS's own timing/position rules.
    // A portal to <body> with position:fixed both escapes every
    // overflow-hidden ancestor between the block and the page (the
    // calendar card, each day column's own clipped scroller) and lets the
    // tooltip track the actual cursor position — important since blocks
    // vary hugely in height (18px to several hundred), so an
    // element-anchored tooltip (e.g. always below the block) can land far
    // from wherever the pointer actually is on a tall block.
    mockCalendarShifts = [calendarShift({})];
    render(<RosterCalendarView />);
    const block = document.querySelector('[data-shift-id="shift-1"]') as HTMLElement;
    expect(block).toBeTruthy();
    expect(block.getAttribute("title")).toBeNull();
    expect(screen.queryByText(/Duty Manager.*Unassigned/)).not.toBeInTheDocument();

    fireEvent.mouseEnter(block, { clientX: 120, clientY: 340 });
    const tooltip = document.body.querySelector(".fixed.z-50.pointer-events-none") as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toContain("Duty Manager");
    expect(tooltip.textContent).toContain("Unassigned");
    expect(tooltip.style.left).toBe("134px"); // clientX + 14
    expect(tooltip.style.top).toBe("354px"); // clientY + 14

    fireEvent.mouseMove(block, { clientX: 200, clientY: 400 });
    expect(tooltip.style.left).toBe("214px");
    expect(tooltip.style.top).toBe("414px");

    fireEvent.mouseLeave(block);
    expect(document.body.querySelector(".fixed.z-50.pointer-events-none")).not.toBeInTheDocument();
  });

  it("two overlapping shifts for the same role render side-by-side, not stacked on top of each other", () => {
    // Two real (non-Cancelled) Draft shifts, same role/day, overlapping
    // 8:00-8:15am — exactly the "overlap for Sep 14 8AM" report: 7:45-8:15am
    // and 8:00-9:00am both assigned to Front of House at the same venue.
    mockCalendarShifts = [
      calendarShift({ shiftId: "shift-a", startDatetime: localIso(weekStartIso, 7, 45), endDatetime: localIso(weekStartIso, 8, 15) }),
      calendarShift({ shiftId: "shift-b", startDatetime: localIso(weekStartIso, 8), endDatetime: localIso(weekStartIso, 9) }),
    ];
    render(<RosterCalendarView />);
    const blockA = document.querySelector('[data-shift-id="shift-a"]') as HTMLElement;
    const blockB = document.querySelector('[data-shift-id="shift-b"]') as HTMLElement;
    expect(blockA).toBeTruthy();
    expect(blockB).toBeTruthy();
    expect(blockA.style.left).not.toBe(blockB.style.left);
    expect(blockA.style.width).toContain("50%");
    expect(blockB.style.width).toContain("50%");
  });

  it("non-overlapping shifts for the same role still use the lane's full width", () => {
    mockCalendarShifts = [
      calendarShift({ shiftId: "shift-a", startDatetime: localIso(weekStartIso, 8), endDatetime: localIso(weekStartIso, 9) }),
      calendarShift({ shiftId: "shift-b", startDatetime: localIso(weekStartIso, 10), endDatetime: localIso(weekStartIso, 11) }),
    ];
    render(<RosterCalendarView />);
    const blockA = document.querySelector('[data-shift-id="shift-a"]') as HTMLElement;
    const blockB = document.querySelector('[data-shift-id="shift-b"]') as HTMLElement;
    expect(blockA.style.left).toBe(blockB.style.left);
    expect(blockA.style.width).toBe(blockB.style.width);
    expect(blockA.style.width).toContain("100%");
  });

  it("three mutually-overlapping shifts for the same role split into three columns", () => {
    // a: 8:00-9:00, b: 8:15-9:15, c: 8:30-9:30 — no single pair spans the
    // whole window, but all three are concurrent around 8:30-9:00, so all
    // three need their own column (assignOverlapColumns' colEnds-reuse
    // check must actually run per-item, not just check pairwise overlap).
    mockCalendarShifts = [
      calendarShift({ shiftId: "shift-a", startDatetime: localIso(weekStartIso, 8, 0), endDatetime: localIso(weekStartIso, 9, 0) }),
      calendarShift({ shiftId: "shift-b", startDatetime: localIso(weekStartIso, 8, 15), endDatetime: localIso(weekStartIso, 9, 15) }),
      calendarShift({ shiftId: "shift-c", startDatetime: localIso(weekStartIso, 8, 30), endDatetime: localIso(weekStartIso, 9, 30) }),
    ];
    render(<RosterCalendarView />);
    const blocks = ["shift-a", "shift-b", "shift-c"].map(
      (id) => document.querySelector(`[data-shift-id="${id}"]`) as HTMLElement,
    );
    blocks.forEach((b) => expect(b).toBeTruthy());

    const lefts = blocks.map((b) => b.style.left);
    expect(new Set(lefts).size).toBe(3); // three distinct columns, not two shifts sharing one
    for (const b of blocks) {
      expect(b.style.width).toMatch(/33\.3+/); // 100/3, not 50 (would mean only 2 columns were used)
    }
  });
});
