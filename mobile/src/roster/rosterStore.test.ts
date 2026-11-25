import { describe, it, expect, vi } from "vitest";
import type { MyShift, OpenSwap } from "@culinaire/shared/schemas/roster";
import { ApiError, type ApiClient } from "../api/client";
import { createRosterApi, type RosterApi } from "./rosterApi";
import { createRosterStore } from "./rosterStore";

const NOW = Date.parse("2026-11-25T22:00:00Z");
const shift = (over: Partial<MyShift> = {}): MyShift => ({ shiftId: "s1", assignmentId: "a1", storeLocationId: "L1", locationName: "Bar", ianaTimezone: "Australia/Melbourne", roleName: "Chef", startDatetime: "2026-11-27T22:00:00Z", endDatetime: "2026-11-28T06:00:00Z", status: "Published", isPublicHoliday: false, assignmentStatus: "Pending", publicHolidayConsent: null, ...over });
const swap = (over: Partial<OpenSwap> = {}): OpenSwap => ({ swapRequestId: "w1", shiftId: "s9", fromAssignmentId: "a9", fromUserId: 2, fromUserName: "Sam", startDatetime: "2026-11-27T22:00:00Z", endDatetime: "2026-11-28T06:00:00Z", roleName: "Chef", storeLocationId: "L1", ...over });

/** A small server: the rows it holds, and what each write answers. */
function setup(rows: { shifts?: MyShift[]; swaps?: OpenSwap[] } = {}) {
  const server = { shifts: rows.shifts ?? [shift()], swaps: rows.swaps ?? [] };
  const api = {
    shifts: vi.fn(async () => server.shifts),
    swaps: vi.fn(async () => server.swaps),
    respond: vi.fn(async (_id: string, r: string) => void (server.shifts = server.shifts.map((s) => ({ ...s, assignmentStatus: r })))),
    consent: vi.fn(async () => {}),
    offer: vi.fn(async () => {}),
    claim: vi.fn(async () => {}),
    cancelSwap: vi.fn(async () => {}),
    availability: vi.fn(async () => []),
  };
  return { server, api, store: createRosterStore({ api: api as unknown as RosterApi, now: () => NOW }) };
}
const err = (code: ConstructorParameters<typeof ApiError>[0], status = 0, body?: unknown, serverCode?: string) => new ApiError(code, undefined, status, body, serverCode);

describe("the roster calls", () => {
  it("asks for published shifts from before this week's Monday in any zone", async () => {
    const request = vi.fn(async () => []);
    const store = createRosterStore({ api: createRosterApi({ request } as unknown as ApiClient), now: () => NOW });
    await store.refresh();
    expect(request.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["GET", "/api/roster/shifts/mine?excludeDrafts=true&from=2026-11-16&limit=500"],
      ["GET", "/api/workforce/swaps"],
    ]);
  });
});

describe("reading the roster", () => {
  it("says the roster is off when the server hides it, and swaps off on their own", async () => {
    const off = setup();
    off.api.shifts.mockRejectedValue(err("not_found", 404));
    await off.store.refresh();
    expect(off.store.getSnapshot()).toMatchObject({ phase: "ready", off: true });
    const noSwaps = setup();
    noSwaps.api.swaps.mockRejectedValue(err("not_found", 404));
    await noSwaps.store.refresh();
    expect(noSwaps.store.getSnapshot()).toMatchObject({ phase: "ready", off: false, swaps: null, shifts: [{ assignmentId: "a1" }] });
  });

  it("keeps what is on screen when a later read fails, and fails plainly when there is nothing", async () => {
    const t = setup();
    t.api.shifts.mockRejectedValueOnce(err("network"));
    await t.store.refresh();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", error: "This needs a connection: it isn't kept on this phone." });
    await t.store.refresh();
    t.api.shifts.mockRejectedValueOnce(err("network"));
    await t.store.refresh();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "ready", shifts: [{ assignmentId: "a1" }], error: "This needs a connection: it isn't kept on this phone." });
  });

  it("takes everything off the screen when the permission is taken away", async () => {
    const t = setup();
    await t.store.refresh();
    t.api.shifts.mockRejectedValueOnce(err("forbidden", 403));
    await t.store.refresh();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", shifts: [], swaps: null });
  });

  it("never lets a slow old read replace a newer one", async () => {
    const t = setup();
    let slow!: (rows: MyShift[]) => void;
    t.api.shifts.mockReturnValueOnce(new Promise((r) => (slow = r)));
    const first = t.store.refresh();
    t.server.shifts = [shift({ assignmentStatus: "Confirmed" })];
    await t.store.refresh();
    slow([shift()]);
    await first;
    expect(t.store.getSnapshot().shifts[0].assignmentStatus).toBe("Confirmed");
  });
});

describe("answering a shift", () => {
  it("shows the server's answer after it", async () => {
    const t = setup();
    await t.store.refresh();
    expect(await t.store.respond("a1", "Confirmed")).toBe(true);
    expect(t.store.getSnapshot()).toMatchObject({ busy: null, shifts: [{ assignmentStatus: "Confirmed" }], notice: { bad: false, text: "You're confirmed for this shift.", about: "a1" } });
  });

  it("counts a lost reply, or a repeat the server refuses, as done only when the shift shows it", async () => {
    for (const failure of [err("timeout"), err("conflict", 409)]) {
      const t = setup();
      t.api.respond.mockImplementationOnce(async (_id, r) => {
        t.server.shifts = [shift({ assignmentStatus: r })];
        throw failure;
      });
      await t.store.refresh();
      expect(await t.store.respond("a1", "Declined")).toBe(true);
    }
    const lost = setup();
    lost.api.respond.mockRejectedValueOnce(err("network"));
    await lost.store.refresh();
    expect(await lost.store.respond("a1", "Declined")).toBe(false);
    expect(lost.store.getSnapshot().notice).toMatchObject({ bad: true, text: "That didn't go through. It needs a connection: try again with a signal." });
  });

  it("does not claim to know when it cannot read the roster again", async () => {
    const t = setup();
    await t.store.refresh();
    t.api.respond.mockRejectedValueOnce(err("timeout"));
    t.api.shifts.mockRejectedValueOnce(err("network"));
    await t.store.respond("a1", "Confirmed");
    expect(t.store.getSnapshot().notice?.text).toBe("Can't tell whether that went through. Refresh with a signal before trying again.");
  });

  it("takes one tap at a time", async () => {
    const t = setup();
    await t.store.refresh();
    const [a, b] = await Promise.all([t.store.respond("a1", "Confirmed"), t.store.respond("a1", "Declined")]);
    expect([a, b, t.api.respond.mock.calls.length]).toEqual([true, false, 1]);
  });

  it("answers the public holiday question on its own", async () => {
    const t = setup({ shifts: [shift({ publicHolidayConsent: "Requested" })] });
    await t.store.refresh();
    await t.store.consent("a1", "Accepted");
    expect(t.api.consent).toHaveBeenCalledWith("a1", "Accepted");
    expect(t.api.respond).not.toHaveBeenCalled();
  });
});

describe("swaps", () => {
  it("offers a shift; an offer already made is not an error", async () => {
    const t = setup({ swaps: [] });
    await t.store.refresh();
    t.api.offer.mockImplementationOnce(async () => {
      t.server.swaps = [swap({ fromAssignmentId: "a1", fromUserId: 1 })];
      throw err("conflict", 409);
    });
    expect(await t.store.offer("a1")).toBe(true);
    expect(t.store.mySwap("a1")).toBeDefined();
  });

  it("takes an offer back, and says when someone claimed it first", async () => {
    const t = setup({ swaps: [swap({ fromAssignmentId: "a1", fromUserId: 1 })] });
    await t.store.refresh();
    t.api.cancelSwap.mockImplementationOnce(async () => void (t.server.swaps = []));
    expect(await t.store.cancelOffer("a1")).toBe(true);
    expect(t.api.cancelSwap).toHaveBeenCalledWith("w1");

    const late = setup({ swaps: [swap({ fromAssignmentId: "a1", fromUserId: 1 })] });
    await late.store.refresh();
    late.api.cancelSwap.mockImplementationOnce(async () => {
      late.server.swaps = [];
      late.server.shifts = [];
      throw err("not_found", 404);
    });
    expect(await late.store.cancelOffer("a1")).toBe(false);
    expect(late.store.getSnapshot().notice?.text).toBe("Someone has already taken this shift.");
  });

  it("claims a shift; a replay the server already gave me is a success", async () => {
    const t = setup({ swaps: [swap()] });
    await t.store.refresh();
    t.api.claim.mockImplementationOnce(async () => {
      t.server.shifts = [shift({ shiftId: "s9", assignmentId: "a10", assignmentStatus: "Confirmed" })];
      t.server.swaps = [];
      throw err("conflict", 409, undefined, "SWAP_CLAIMED_BY_YOU");
    });
    expect(await t.store.claim(swap())).toBe(true);
    expect(t.store.getSnapshot().notice?.text).toBe("The shift is yours.");
  });

  it("does not call a claim made when the shift was already mine", async () => {
    const t = setup({ shifts: [shift({ shiftId: "s9", assignmentStatus: "Confirmed" })], swaps: [swap()] });
    await t.store.refresh();
    t.api.claim.mockRejectedValueOnce(err("conflict", 409, undefined, "SHIFT_ALREADY_ASSIGNED"));
    expect(await t.store.claim(swap())).toBe(false);
    expect(t.store.getSnapshot().notice).toMatchObject({ bad: true, text: "You already work this shift." });
  });

  it("claims a shift I had declined", async () => {
    const t = setup({ shifts: [shift({ shiftId: "s9", assignmentStatus: "Declined" })], swaps: [swap()] });
    await t.store.refresh();
    t.api.claim.mockImplementationOnce(async () => {
      t.server.shifts = [shift({ shiftId: "s9", assignmentStatus: "Confirmed" })];
      t.server.swaps = [];
    });
    expect(await t.store.claim(swap())).toBe(true);
    expect(t.store.getSnapshot().notice?.text).toBe("The shift is yours.");
  });

  it("says in plain words why a claim was refused", async () => {
    const blocked = (b: object) => err("conflict", 409, { error: "Cannot assign. Sam…", blocked: b }, "ASSIGNMENT_BLOCKED_COMPLIANCE");
    const cases: [ApiError, string][] = [
      [err("conflict", 409, undefined, "SWAP_CLAIMED_BY_OTHER"), "Someone else took this shift first."],
      [err("conflict", 409, undefined, "SWAP_CANCELLED"), "The person who offered this shift has taken the offer back."],
      [err("conflict", 409, undefined, "SHIFT_ALREADY_ASSIGNED"), "You already work this shift."],
      [blocked({ documentType: "RSA", reason: "expired", expiryDate: "2026-06-15" }), "You can't take this shift: your RSA expired on 15 June 2026."],
      [blocked({ documentType: "RSA", reason: "missing", expiryDate: null }), "You can't take this shift until you add your RSA."],
      [blocked({ documentType: "RSA", reason: "unverified", expiryDate: null }), "You can't take this shift until your manager has checked your RSA."],
    ];
    for (const [failure, text] of cases) {
      const t = setup({ swaps: [swap()] });
      await t.store.refresh();
      t.api.claim.mockRejectedValueOnce(failure);
      expect(await t.store.claim(swap())).toBe(false);
      expect(t.store.getSnapshot().notice).toMatchObject({ bad: true, text });
    }
  });
});
