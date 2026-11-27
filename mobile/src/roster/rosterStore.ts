/**
 * My shifts and the open swaps. The last answer is kept sealed on the phone (`lockedCache`) and shown, with its time, when the server cannot be
 * reached; nothing is queued. Every write is online: an answer is to the shift as it stands now, and a swap is first come, first served. The server holds the truth:
 * after a write it is read again, and a write whose answer was lost (or that the server says was already made) counts as done only when
 * the fresh copy shows it.
 */

import { AssignmentBlockedBodySchema, MyShiftsSchema, OpenSwapsSchema, SWAP_CODES, type MyShift, type OpenSwap } from "@culinaire/shared/schemas/roster";
import { formatAuDate } from "@culinaire/shared";
import { ApiError } from "../api/client";
import { answerLost, readMessage } from "../api/onlineWrite";
import type { StoreCache } from "../lock/lockedCache";
import type { RosterApi } from "./rosterApi";
import { worksShift } from "./shiftView";

export interface RosterSnapshot {
  phase: "loading" | "ready" | "failed";
  /** The kitchen has not switched the roster on (the server answers 404 to everyone). */
  off: boolean;
  /** Why the last read failed; whatever was read before it stays on screen. */
  error: string | null;
  /** When what is shown was saved, if it is the phone's copy because the server could not be reached. */
  savedAt: string | null;
  shifts: MyShift[];
  /** Null when swaps are switched off here. */
  swaps: OpenSwap[] | null;
  /** The assignment or swap being changed. */
  busy: string | null;
  /** What the last action did, good or bad. */
  notice: { text: string; bad: boolean; about: string } | null;
}

const isOff = (err: unknown) => err instanceof ApiError && err.code === "not_found";
const Copy = { parse: (data: unknown) => { const d = data as { shifts: unknown; swaps: unknown }; return { shifts: MyShiftsSchema.parse(d.shifts), swaps: d.swaps === null ? null : OpenSwapsSchema.parse(d.swaps) }; } };
const DAY = 86_400_000;

/** One plain sentence for a refused claim, by the server's code. */
export function claimMessage(err: ApiError): string {
  if (err.hasCode(SWAP_CODES.claimedByOther)) return "Someone else took this shift first.";
  if (err.hasCode(SWAP_CODES.cancelled)) return "The person who offered this shift has taken the offer back.";
  if (err.hasCode(SWAP_CODES.alreadyAssigned)) return "You already work this shift.";
  if (err.hasCode(SWAP_CODES.blocked)) {
    const blocked = AssignmentBlockedBodySchema.safeParse(err.body).data?.blocked;
    if (!blocked) return "Your documents don't allow you to take this shift yet.";
    const { documentType, reason, expiryDate } = blocked;
    if (reason === "expired" && expiryDate) return `You can't take this shift: your ${documentType} expired on ${formatAuDate(expiryDate)}.`;
    if (reason === "missing") return `You can't take this shift until you add your ${documentType}.`;
    if (reason === "rejected") return `You can't take this shift: your ${documentType} was not accepted.`;
    return `You can't take this shift until your manager has checked your ${documentType}.`;
  }
  if (err.code === "not_found") return "This swap is no longer open.";
  return err.message;
}

export function createRosterStore({ api, now, cache }: { api: RosterApi; now: () => number; cache?: StoreCache }) {
  let snapshot: RosterSnapshot = { phase: "loading", off: false, error: null, savedAt: null, shifts: [], swaps: null, busy: null, notice: null };
  const listeners = new Set<() => void>();
  const set = (next: Partial<RosterSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  // Only the newest read is shown: a slow old one must not put an answered shift back to pending.
  let reads = 0;

  /** True when it read what the server holds now. */
  async function refresh(): Promise<boolean> {
    const mine = ++reads;
    // Nine days back reaches this week's Monday in every zone; `weekOf` decides what is this week on each venue's clock.
    const from = new Date(now() - 9 * DAY).toISOString().slice(0, 10);
    const owner = cache?.owner() ?? null;
    try {
      const [shifts, swaps] = await Promise.all([api.shifts(from), api.swaps().catch((err) => { if (isOff(err)) return null; throw err; })]);
      if (mine === reads) {
        set({ phase: "ready", off: false, error: null, savedAt: null, shifts, swaps });
        void cache?.write("roster", owner, { shifts, swaps });
      }
      return true;
    } catch (err) {
      if (mine !== reads) return false;
      if (isOff(err) || (err instanceof ApiError && err.code === "forbidden")) void cache?.remove("roster");
      if (isOff(err)) set({ phase: "ready", off: true, error: null, savedAt: null, shifts: [], swaps: null });
      // A permission taken away takes what was shown with it.
      else if (err instanceof ApiError && err.code === "forbidden") set({ phase: "failed", error: "You don't have access to the roster.", savedAt: null, shifts: [], swaps: null });
      else {
        // What is on screen is newer than any saved copy.
        const copy = snapshot.phase !== "ready" && answerLost(err) ? await cache?.read("roster", Copy) : null;
        if (mine !== reads) return false;
        if (copy) set({ phase: "ready", off: false, error: readMessage(err), savedAt: copy.at, ...copy.data });
        else set({ phase: snapshot.phase === "ready" ? "ready" : "failed", error: readMessage(err) });
      }
      return false;
    }
  }

  /** `done` reads the fresh snapshot: did the write land? `says` is the good news; `refused` words a refusal. */
  async function act(about: string, run: () => Promise<void>, done: () => boolean, says: () => string, refused: (err: ApiError) => string = (err) => err.message): Promise<boolean> {
    if (snapshot.busy) return false;
    set({ busy: about, notice: null });
    const tell = (text: string, bad: boolean) => {
      set({ busy: null, notice: { text, bad, about } });
      return !bad;
    };
    try {
      await run();
    } catch (err) {
      const read = await refresh();
      if (read && done()) return tell(says(), false);
      if (!(err instanceof ApiError)) return tell("Something went wrong. Try again.", true);
      if (answerLost(err)) return tell(read ? "That didn't go through. It needs a connection: try again with a signal." : "Can't tell whether that went through. Refresh with a signal before trying again.", true);
      return tell(refused(err), true);
    }
    await refresh();
    return tell(says(), false);
  }

  const shiftOf = (assignmentId: string) => snapshot.shifts.find((s) => s.assignmentId === assignmentId);
  const mySwap = (assignmentId: string) => snapshot.swaps?.find((s) => s.fromAssignmentId === assignmentId);

  return {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    refresh,
    clearNotice: () => snapshot.notice && set({ notice: null }),
    mySwap,

    respond(assignmentId: string, response: "Confirmed" | "Declined") {
      return act(assignmentId, () => api.respond(assignmentId, response), () => shiftOf(assignmentId)?.assignmentStatus === response, () => (response === "Confirmed" ? "You're confirmed for this shift." : "You declined this shift."));
    },
    consent(assignmentId: string, response: "Accepted" | "Declined") {
      return act(assignmentId, () => api.consent(assignmentId, response), () => shiftOf(assignmentId)?.publicHolidayConsent === response, () => (response === "Accepted" ? "You agreed to work this public holiday." : "You declined this public holiday shift."));
    },
    offer(assignmentId: string) {
      return act(assignmentId, () => api.offer(assignmentId), () => mySwap(assignmentId) !== undefined, () => "Offered for swap. The shift stays yours until someone takes it.");
    },
    /** Taking an offer back. If the shift is no longer mine, someone claimed it first. */
    cancelOffer(assignmentId: string) {
      const swap = mySwap(assignmentId);
      if (!swap) return Promise.resolve(false);
      return act(assignmentId, () => api.cancelSwap(swap.swapRequestId), () => shiftOf(assignmentId) !== undefined && mySwap(assignmentId) === undefined, () => "Your offer is taken back. The shift is still yours.", (err) => (shiftOf(assignmentId) ? err.message : "Someone has already taken this shift."));
    },
    claim(swap: OpenSwap) {
      const worked = worksShift(snapshot.shifts, swap.shiftId);
      return act(swap.swapRequestId, () => api.claim(swap.swapRequestId).catch((err) => { if (!(err instanceof ApiError && err.hasCode(SWAP_CODES.claimedByYou))) throw err; }), () => !worked && snapshot.shifts.some((s) => s.shiftId === swap.shiftId && s.assignmentStatus === "Confirmed"), () => "The shift is yours.", claimMessage);
    },
  };
}

export type RosterStore = ReturnType<typeof createRosterStore>;
