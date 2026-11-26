// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import type { Availability, MyShift, OpenSwap } from "@culinaire/shared/schemas/roster";
import { ApiError } from "../src/api/client";
import { createAvailabilityStore } from "../src/roster/availabilityStore";
import { RosterContextProvider } from "../src/roster/RosterProvider";
import type { RosterApi } from "../src/roster/rosterApi";
import { createRosterStore } from "../src/roster/rosterStore";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, client: {}, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});

import Roster from "../app/(app)/(roster)/index";
import Shift from "../app/(app)/(roster)/shift";
import Swaps from "../app/(app)/(roster)/swaps";
import AvailabilityScreen from "../app/(app)/(roster)/availability";
import AvailabilityEdit from "../app/(app)/(roster)/availability-edit";

/** Thursday 26 November 2026, 9 am in Melbourne; the tests' own zone must not matter. */
const NOW = Date.parse("2026-11-25T22:00:00Z");
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch", ianaTimezone: "Australia/Melbourne" };
const shift = (over: Partial<MyShift> = {}): MyShift => ({ shiftId: "s1", assignmentId: "a1", storeLocationId: "L1", locationName: "Main Kitchen", ianaTimezone: "Australia/Melbourne", roleName: "Chef de partie", startDatetime: "2026-11-26T22:00:00Z", endDatetime: "2026-11-27T06:00:00Z", status: "Published", isPublicHoliday: false, assignmentStatus: "Pending", publicHolidayConsent: null, ...over });
const offer = (over: Partial<OpenSwap> = {}): OpenSwap => ({ swapRequestId: "w1", shiftId: "s9", fromAssignmentId: "a9", fromUserId: 2, fromUserName: "Sam", startDatetime: "2026-11-27T22:00:00Z", endDatetime: "2026-11-28T06:00:00Z", roleName: "Bar", storeLocationId: "L1", ...over });

const api = { shifts: vi.fn(), swaps: vi.fn(), respond: vi.fn(), consent: vi.fn(), offer: vi.fn(), claim: vi.fn(), cancelSwap: vi.fn(), availability: vi.fn(), addAvailability: vi.fn(), changeAvailability: vi.fn(), removeAvailability: vi.fn() } satisfies Record<keyof RosterApi, ReturnType<typeof vi.fn>>;

function open(ui: ReactNode, server: { shifts?: MyShift[]; swaps?: OpenSwap[]; availability?: Availability[] } = {}) {
  api.shifts.mockImplementation(async () => server.shifts ?? []);
  api.swaps.mockImplementation(async () => server.swaps ?? []);
  api.availability.mockImplementation(async () => server.availability ?? []);
  const ctx = {
    roster: createRosterStore({ api: api as unknown as RosterApi, now: () => NOW }),
    availability: createAvailabilityStore(api as unknown as RosterApi),
  };
  return { ctx, ...render(<RosterContextProvider value={ctx}>{ui}</RosterContextProvider>) };
}

/** Answers an Alert by pressing the button with this label. */
const answer = (label: string) => vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === label)?.onPress?.());
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  sessionState.current = { state: { phase: "ready", user: { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["roster:read-own"] }, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
  Object.values(api).forEach((f) => f.mockReset());
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("my shifts", () => {
  it("lists this week and next on the venue's clock, says what needs an answer, and opens a shift", async () => {
    open(<Roster />, { shifts: [shift(), shift({ shiftId: "s2", assignmentId: "a2", startDatetime: "2026-12-01T22:00:00Z", endDatetime: "2026-12-02T06:00:00Z", ianaTimezone: "Australia/Perth", locationName: "Perth Bar", assignmentStatus: "Confirmed", isPublicHoliday: true })] });
    await screen.findByText("This week");
    expect(screen.getByText("1 shift needs your answer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wed 2 Dec, 6:00 am–2:00 pm, Chef de partie, Perth Bar, Public holiday, Confirmed" })).toBeTruthy();
    press("Fri 27 Nov, 9:00 am–5:00 pm, Chef de partie, Main Kitchen, Needs your answer");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/shift", params: { shiftId: "s1" } });
  });

  it("never shows a draft shift; a consent question on one is pointed to the web", async () => {
    open(<Roster />, { shifts: [shift({ status: "Draft", publicHolidayConsent: "Requested", roleName: "Secret role" })] });
    expect(await screen.findByText("A public holiday question")).toBeTruthy();
    expect(screen.queryByText(/Secret role/)).toBeNull();
    expect(screen.getByText("No shifts yet")).toBeTruthy();
  });

  it("says when there is nothing, when the roster is off and when swaps are off", async () => {
    open(<Roster />);
    expect(await screen.findByText("No shifts yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open swaps" })).toBeTruthy();
    cleanup();
    const off = open(<Roster />);
    api.shifts.mockRejectedValue(new ApiError("not_found", undefined, 404));
    await off.ctx.roster.refresh();
    expect(await screen.findByText("The roster isn't in use here")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "My availability" })).toBeNull();
    cleanup();
    const noSwaps = open(<Roster />);
    api.swaps.mockRejectedValue(new ApiError("not_found", undefined, 404));
    await noSwaps.ctx.roster.refresh();
    expect(screen.queryByRole("button", { name: /Open swaps/ })).toBeNull();
  });

  it("with no signal says so and offers to try again, and shows the list once it can", async () => {
    const t = open(<Roster />, { shifts: [shift()] });
    await screen.findByText("This week");
    api.shifts.mockRejectedValueOnce(new ApiError("network"));
    await t.ctx.roster.refresh();
    expect(await screen.findByText("This needs a connection: it isn't kept on this phone. What you see may be out of date.")).toBeTruthy();
    press("Try again");
    await vi.waitFor(() => expect(screen.queryByText(/out of date/)).toBeNull());
  });

  it("counts the open swaps of colleagues that have not started", async () => {
    open(<Roster />, { swaps: [offer(), offer({ swapRequestId: "w2", fromUserId: 1 }), offer({ swapRequestId: "w3", startDatetime: "2026-11-24T22:00:00Z" })] });
    expect(await screen.findByRole("button", { name: "Open swaps, 1 open" })).toBeTruthy();
  });
});

describe("one shift", () => {
  it("confirms a pending shift", async () => {
    searchParams.current = { shiftId: "s1" };
    const server = { shifts: [shift()] };
    open(<Shift />, server);
    expect(await screen.findByText("Friday 27 November 2026")).toBeTruthy();
    expect(screen.getByLabelText("Time: 9:00 am–5:00 pm (8 h)")).toBeTruthy();
    api.respond.mockImplementation(async () => void (server.shifts = [shift({ assignmentStatus: "Confirmed" })]));
    press("Confirm shift");
    expect(await screen.findByText("You're confirmed for this shift.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm shift" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offer to swap" })).toBeTruthy();
  });

  it("asks before declining, and does nothing on Not now", async () => {
    searchParams.current = { shiftId: "s1" };
    open(<Shift />, { shifts: [shift()] });
    await screen.findByText("Friday 27 November 2026");
    answer("Not now");
    press("Decline");
    expect(api.respond).not.toHaveBeenCalled();
    answer("Decline");
    press("Decline");
    await vi.waitFor(() => expect(api.respond).toHaveBeenCalledWith("a1", "Declined"));
  });

  it("asks the public holiday question apart from the shift", async () => {
    searchParams.current = { shiftId: "s1" };
    const server = { shifts: [shift({ assignmentStatus: "Confirmed", isPublicHoliday: true, publicHolidayConsent: "Requested" })] };
    open(<Shift />, server);
    await screen.findByText("Would you work this public holiday?");
    // Two questions: the shift itself is already answered.
    expect(screen.getByLabelText("Your answer: Confirmed")).toBeTruthy();
    api.consent.mockImplementation(async () => void (server.shifts = [shift({ assignmentStatus: "Confirmed", isPublicHoliday: true, publicHolidayConsent: "Accepted" })]));
    press("Yes, I'll work it");
    await vi.waitFor(() => expect(screen.getAllByText("You agreed to work this public holiday.").length).toBeGreaterThan(0));
    expect(api.respond).not.toHaveBeenCalled();
  });

  it("offers a confirmed shift and takes the offer back", async () => {
    searchParams.current = { shiftId: "s1" };
    const server = { shifts: [shift({ assignmentStatus: "Confirmed" })], swaps: [] as OpenSwap[] };
    open(<Shift />, server);
    await screen.findByRole("button", { name: "Offer to swap" });
    api.offer.mockImplementation(async () => void (server.swaps = [offer({ fromAssignmentId: "a1", fromUserId: 1 })]));
    answer("Offer it");
    press("Offer to swap");
    await screen.findByRole("button", { name: "Take the offer back" });
    expect(api.offer).toHaveBeenCalledWith("a1");
    api.cancelSwap.mockImplementation(async () => void (server.swaps = []));
    press("Take the offer back");
    expect(await screen.findByText("Your offer is taken back. The shift is still yours.")).toBeTruthy();
  });

  it("says who won when the shift was taken while the offer was being taken back", async () => {
    searchParams.current = { shiftId: "s1", from: "link" };
    const server = { shifts: [shift({ assignmentStatus: "Confirmed" })], swaps: [offer({ fromAssignmentId: "a1", fromUserId: 1 })] };
    open(<Shift />, server);
    await screen.findByRole("button", { name: "Take the offer back" });
    api.cancelSwap.mockImplementation(async () => {
      server.shifts = [];
      server.swaps = [];
      throw new ApiError("not_found", "Swap request not found", 404);
    });
    press("Take the offer back");
    expect(await screen.findByText("Someone has already taken this shift.")).toBeTruthy();
    press("Back to my shifts");
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/(app)/(roster)");
  });

  it("offers nothing to do on a finished shift, a draft, or with swaps off", async () => {
    searchParams.current = { shiftId: "s1" };
    open(<Shift />, { shifts: [shift({ startDatetime: "2026-11-24T22:00:00Z", endDatetime: "2026-11-25T06:00:00Z" })] });
    await screen.findByText(/This shift is finished/);
    for (const name of ["Confirm shift", "Decline", "Offer to swap"]) expect(screen.queryByRole("button", { name })).toBeNull();
    cleanup();
    open(<Shift />, { shifts: [shift({ status: "Draft" })] });
    expect(await screen.findByText("Not on your roster")).toBeTruthy();
    cleanup();
    const t = open(<Shift />, { shifts: [shift({ assignmentStatus: "Confirmed" })] });
    api.swaps.mockRejectedValue(new ApiError("not_found", undefined, 404));
    await t.ctx.roster.refresh();
    await screen.findByText("Friday 27 November 2026");
    expect(screen.queryByRole("button", { name: "Offer to swap" })).toBeNull();
  });
});

describe("open swaps", () => {
  it("takes a colleague's shift after asking, and says why when the server refuses", async () => {
    const server = { swaps: [offer()], shifts: [] as MyShift[] };
    open(<Swaps />, server);
    await screen.findByText("Bar · Main Kitchen · Offered by Sam");
    api.claim.mockRejectedValueOnce(new ApiError("conflict", "x", 409, { blocked: { documentType: "RSA", reason: "missing", expiryDate: null } }, "ASSIGNMENT_BLOCKED_COMPLIANCE"));
    const alert = answer("Take it");
    press("Take Sat 28 Nov");
    expect(alert.mock.calls[0].slice(0, 2)).toEqual(["Take this shift?", "Sat 28 Nov, 9:00 am–5:00 pm. You'll be confirmed for it straight away."]);
    expect(await screen.findByText("You can't take this shift until you add your RSA.")).toBeTruthy();
    api.claim.mockImplementation(async () => {
      server.swaps = [];
      server.shifts = [shift({ shiftId: "s9", assignmentStatus: "Confirmed" })];
    });
    press("Take Sat 28 Nov");
    expect(await screen.findByText("The shift is yours.")).toBeTruthy();
    expect(screen.getByText("No open swaps")).toBeTruthy();
  });

  it("shows venue time at any venue of the organisation, and no swap of a draft or cancelled shift", async () => {
    open(<Swaps />, { swaps: [offer({ storeLocationId: "L9", ianaTimezone: "Australia/Perth", locationName: "Perth Bar", shiftStatus: "Published" }), offer({ swapRequestId: "w2", shiftStatus: "Draft", roleName: "Secret" }), offer({ swapRequestId: "w3", shiftStatus: "Cancelled", roleName: "Gone" })] });
    expect(await screen.findByText("Bar · Perth Bar · Offered by Sam")).toBeTruthy();
    expect(screen.getByText("6:00 am–2:00 pm (8 h)")).toBeTruthy();
    expect(screen.queryByText(/Secret|Gone|venue you don't work at/)).toBeNull();
  });

  it("never shows a swap whose venue's zone it does not know (it says where to see it), nor my own offer", async () => {
    open(<Swaps />, { swaps: [offer({ storeLocationId: "L9", roleName: "Elsewhere" }), offer({ swapRequestId: "w2", fromUserId: 1, fromUserName: "Me" })] });
    expect(await screen.findByText("1 more is at a venue you don't work at. See it on the web.")).toBeTruthy();
    expect(screen.queryByText(/Elsewhere|Offered by Me|am–|pm–/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    expect(screen.getByText("No open swaps")).toBeTruthy();
  });

  it("says when swaps are off", async () => {
    const t = open(<Swaps />);
    api.swaps.mockRejectedValue(new ApiError("not_found", undefined, 404));
    await t.ctx.roster.refresh();
    expect(await screen.findByText("Swaps aren't in use here")).toBeTruthy();
  });
});

describe("my availability", () => {
  const saved: Availability = { staffAvailabilityId: "v1", storeLocationId: null, dayOfWeek: 1, availableFrom: "09:00", availableUntil: "17:00", effectiveFrom: "2026-11-01", effectiveUntil: null };

  it("lists the windows and removes one after asking; a removal with no signal says so and keeps the row", async () => {
    const server = { availability: [saved] };
    open(<AvailabilityScreen />, server);
    await screen.findByText("Monday 09:00–17:00");
    expect(screen.getByText("From 1 November 2026")).toBeTruthy();
    press("Change");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/availability-edit", params: { id: "v1" } });
    answer("Remove");
    api.removeAvailability.mockRejectedValueOnce(new ApiError("network"));
    press("Remove");
    expect(await screen.findByText("Removing it needs a connection. Try again with a signal.")).toBeTruthy();
    api.removeAvailability.mockImplementationOnce(async () => void (server.availability = []));
    press("Remove");
    expect(await screen.findByText("No availability yet")).toBeTruthy();
  });

  it("with no signal says so and offers nothing to change", async () => {
    api.availability.mockRejectedValue(new ApiError("network"));
    const availability = createAvailabilityStore(api as unknown as RosterApi);
    const roster = createRosterStore({ api: api as unknown as RosterApi, now: () => NOW });
    render(<RosterContextProvider value={{ roster, availability }}><AvailabilityScreen /></RosterContextProvider>);
    expect(await screen.findByText("This needs a connection: it isn't kept on this phone.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add availability" })).toBeNull();
  });

  it("starts an empty list with a card", async () => {
    open(<AvailabilityScreen />);
    expect(await screen.findByText("No availability yet")).toBeTruthy();
    press("Add availability");
    expect(routerMock.push).toHaveBeenCalledWith("/availability-edit");
  });

  it("adds a window typed on the number pad, starting on the venue's own today", async () => {
    // 11:30 pm on the 25th in Perth, already the 26th in Melbourne.
    vi.setSystemTime(Date.parse("2026-11-25T15:30:00Z"));
    sessionState.current = { state: { ...(sessionState.current.state as object), location: { ...main, ianaTimezone: "Australia/Perth" } }, busy: false };
    open(<AvailabilityEdit />);
    expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("25/11/2026");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Day" })).getByRole("radio", { name: "Sunday" }));
    type("From", "0630");
    type("Until", "1430");
    type("Last day (optional)", "31122026");
    expect(screen.getByText("31 December 2026")).toBeTruthy();
    press("Save");
    await vi.waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(api.addAvailability).toHaveBeenCalledWith({ storeLocationId: null, dayOfWeek: 0, availableFrom: "06:30", availableUntil: "14:30", effectiveFrom: "2026-11-25", effectiveUntil: "2026-12-31" });
  });

  it("refuses what the server would on the form, and keeps what was typed when saving needs a connection or is refused", async () => {
    const t = open(<AvailabilityEdit />, { availability: [{ ...saved, effectiveFrom: "2026-11-26" }] });
    await t.ctx.availability.refresh();
    press("Save");
    expect(await screen.findByText("You already have this availability.")).toBeTruthy();
    type("Until", "0800");
    press("Save");
    expect(screen.getByText(/must be after the start time/)).toBeTruthy();
    expect(api.addAvailability).not.toHaveBeenCalled();
    type("Until", "1800");
    api.addAvailability.mockRejectedValueOnce(new ApiError("network"));
    press("Save");
    expect(await screen.findByText("Saving needs a connection. Try again with a signal.")).toBeTruthy();
    api.addAvailability.mockRejectedValueOnce(new ApiError("bad_request", "Server says no", 400));
    press("Save");
    expect(await screen.findByText("Server says no")).toBeTruthy();
    expect((screen.getByLabelText("Until") as HTMLInputElement).value).toBe("18:00");
    expect(routerMock.back).not.toHaveBeenCalled();
  });

  it("changes a window, filled in from the server's", async () => {
    searchParams.current = { id: "v1" };
    const t = open(<div />, { availability: [saved] });
    await t.ctx.availability.refresh();
    t.rerender(<RosterContextProvider value={t.ctx}><AvailabilityEdit /></RosterContextProvider>);
    expect((screen.getByLabelText("First day") as HTMLInputElement).value).toBe("01/11/2026");
    type("From", "1000");
    press("Save");
    await vi.waitFor(() => expect(api.changeAvailability).toHaveBeenCalledWith("v1", expect.objectContaining({ availableFrom: "10:00" })));
  });
});

describe("tablet width", () => {
  it.each([["my shifts", Roster], ["a shift", Shift], ["open swaps", Swaps], ["availability", AvailabilityScreen], ["the availability form", AvailabilityEdit]] as const)("keeps %s in one column of 560 dp at iPad width", async (_name, Page) => {
    window.innerWidth = 820;
    window.innerHeight = 1180;
    searchParams.current = { id: "d1", shiftId: "s1" };
    const { container } = open(<Page />, { shifts: [shift()] });
    await vi.waitFor(() => expect([...container.querySelectorAll("div")].some((d) => getComputedStyle(d).maxWidth === "560px")).toBe(true));
  });
});
