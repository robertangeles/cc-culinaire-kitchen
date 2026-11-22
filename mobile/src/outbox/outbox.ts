/**
 * The phone's offline queue. A count is written here first ("Saved on this phone"), then sent when it
 * can be. The rules are the owner-approved offline rules for release 1:
 *
 * - Success keeps the entry as ACCEPTED. A dead network, timeout, 5xx or 429 keeps the count and retries
 *   with backoff. Nothing is ever dropped without the chef seeing it.
 * - A refusal (403, or 400/404/409) puts the count in NEEDS_ATTENTION with the server's message. It is not
 *   resent by itself; the chef retries it (after editing if they like) or discards it. Discards are kept.
 * - A 401 (the session ended) stops the drain and leaves every count where it is.
 * - Sends are capped at 20 a minute, one at a time, oldest first, against the server's 300/min limit.
 * - Entries belong to the account that counted them. Another account signing in does not send them.
 *
 * One entry per item in an area: saving a newer number for an item replaces the older entry's command,
 * even while that entry is being sent, so an older number can never be sent after a newer one.
 *
 * Every change to the queue runs under one lock, and a send finishes against the freshly read entry, never a
 * stale copy: an edit, discard or retry made while a send is in flight is not overwritten by its result.
 *
 * Storage is an adapter (SQLite on the phone, memory in tests); this module holds no state of its own
 * beyond the send timestamps for the rate cap.
 */

import { STOCK_TAKE_CODES } from "@culinaire/shared/schemas/stockTake";
import { ApiError } from "../api/client";

export interface SaveLineCommand {
  sessionId: string;
  categoryName: string;
  ingredientId: string;
  /** For showing the chef what is stuck; the server only needs the id. */
  ingredientName: string;
  rawQty: number;
  countedUnit: string;
  /** The claim this count was made under (the server rejects a count from an earlier claim). */
  claimRevision: number;
}

/** SAVED_LOCAL and SENDING are both "Waiting to send" on screen; ACCEPTED is "Accepted". */
export type OutboxStatus = "SAVED_LOCAL" | "SENDING" | "ACCEPTED" | "NEEDS_ATTENTION" | "DISCARDED";

export type AttentionReason = "signed_out" | "not_yours" | "claim_changed" | "no_access" | "area_closed" | "rejected";

export interface OutboxEntry {
  id: string;
  userId: number;
  status: OutboxStatus;
  command: SaveLineCommand;
  attempts: number;
  /** Epoch ms; 0 means send as soon as possible. */
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  attention?: { reason: AttentionReason; message: string };
}

export interface OutboxStore {
  /** Every entry, oldest first. */
  list(): Promise<OutboxEntry[]>;
  /** Insert, or replace the entry with the same id. */
  put(entry: OutboxEntry): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

export interface OutboxDeps {
  store: OutboxStore;
  /** Performs the request; throws ApiError on any failure. */
  send: (entry: OutboxEntry) => Promise<void>;
  now: () => number;
  newId: () => string;
  /** The signed-in account, or null. */
  getUserId: () => number | null;
}

const RATE_CAP = 20;
const RATE_WINDOW_MS = 60_000;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const OPEN: OutboxStatus[] = ["SAVED_LOCAL", "SENDING", "NEEDS_ATTENTION"];

type Outcome = { kind: "retry" } | { kind: "stop" } | { kind: "attention"; reason: AttentionReason; message: string };

/** The server's code decides; the English text is the fallback until every server sends codes. */
function classify(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return { kind: "retry" };
  switch (err.code) {
    case "unauthorized":
      return { kind: "stop" };
    case "forbidden":
      if (err.hasCode(STOCK_TAKE_CODES.claimedByOther) || err.message.includes("claimed this category")) return { kind: "attention", reason: "not_yours", message: err.message };
      if (err.hasCode(STOCK_TAKE_CODES.claimChanged) || err.message.includes("earlier claim")) return { kind: "attention", reason: "claim_changed", message: err.message };
      return { kind: "attention", reason: "no_access", message: err.message };
    case "bad_request":
      return { kind: "attention", reason: err.hasCode(STOCK_TAKE_CODES.areaClosed) || /^Cannot count: category is/.test(err.message) ? "area_closed" : "rejected", message: err.message };
    case "not_found":
    case "conflict":
    case "upgrade_required":
      return { kind: "attention", reason: "rejected", message: err.message };
    default:
      return { kind: "retry" }; // network, timeout, server, rate_limited
  }
}

const sameItem = (a: SaveLineCommand, b: SaveLineCommand) => a.sessionId === b.sessionId && a.categoryName === b.categoryName && a.ingredientId === b.ingredientId;
const sameCommand = (a: SaveLineCommand, b: SaveLineCommand) => sameItem(a, b) && a.rawQty === b.rawQty && a.countedUnit === b.countedUnit && a.claimRevision === b.claimRevision;

export function createOutbox({ store, send, now, newId, getUserId }: OutboxDeps) {
  const listeners = new Set<() => void>();
  const sendTimes: number[] = [];
  let draining: Promise<{ sent: number; nextWakeAt: number | null }> | null = null;
  let drainAgain = false;

  // Everything that changes the queue runs one at a time. A send itself runs outside the lock (a slow
  // network must not stop the chef saving counts), so its result is applied in a second locked step.
  let chain: Promise<unknown> = Promise.resolve();
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const result = chain.then(work, work);
    chain = result.catch(() => undefined);
    return result;
  }

  const notify = () => listeners.forEach((l) => l());
  async function put(entry: OutboxEntry) {
    await store.put({ ...entry, updatedAt: now() });
    notify();
  }
  const find = async (id: string) => (await store.list()).find((e) => e.id === id);

  /** One pass: send what is due for the signed-in account, within the rate cap. */
  async function runDrain(): Promise<{ sent: number; nextWakeAt: number | null }> {
    let sent = 0;
    for (;;) {
      const userId = getUserId();
      if (userId === null) return { sent, nextWakeAt: null };

      const t = now();
      while (sendTimes.length > 0 && t - sendTimes[0] >= RATE_WINDOW_MS) sendTimes.shift();
      if (sendTimes.length >= RATE_CAP) return { sent, nextWakeAt: sendTimes[0] + RATE_WINDOW_MS };

      // Pick the next due entry and mark it SENDING.
      const picked = await locked(async () => {
        const mine = (await store.list()).filter((e) => e.userId === userId && e.status === "SAVED_LOCAL");
        const due = mine.find((e) => e.nextAttemptAt <= t);
        if (!due) return { nextWakeAt: mine.length > 0 ? Math.min(...mine.map((e) => e.nextAttemptAt)) : null };
        const entry = { ...due, status: "SENDING" as const };
        await put(entry);
        return { entry };
      });
      if (!picked.entry) return { sent, nextWakeAt: picked.nextWakeAt };
      const entry = picked.entry;

      // Someone else may have signed in while we were picking: never send one account's count with another's token.
      if (getUserId() !== userId) {
        await locked(async () => {
          const fresh = await find(entry.id);
          if (fresh?.status === "SENDING") await put({ ...fresh, status: "SAVED_LOCAL" });
        });
        continue;
      }

      sendTimes.push(t);
      let failure: unknown = null;
      try {
        await send(entry);
      } catch (err) {
        failure = err;
      }

      // Apply the result to the entry as it is NOW.
      const stop = await locked(async () => {
        const fresh = await find(entry.id);
        if (!fresh || fresh.status !== "SENDING") return false; // discarded or reset meanwhile: leave it as it is
        if (!sameCommand(fresh.command, entry.command)) {
          // A newer number arrived while this one was in flight. Whatever happened to the old one, send the new one next.
          await put({ ...fresh, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, attention: undefined });
          return false;
        }
        if (failure === null) {
          await put({ ...fresh, status: "ACCEPTED", attention: undefined });
          sent++;
          return false;
        }
        const outcome = classify(failure);
        if (outcome.kind === "attention") {
          await put({ ...fresh, status: "NEEDS_ATTENTION", attempts: fresh.attempts + 1, attention: { reason: outcome.reason, message: outcome.message } });
        } else if (outcome.kind === "stop") {
          await put({ ...fresh, status: "NEEDS_ATTENTION", attempts: fresh.attempts + 1, attention: { reason: "signed_out", message: failure instanceof Error ? failure.message : "Your session has ended. Sign in again." } });
          return true;
        } else {
          const attempts = fresh.attempts + 1;
          await put({ ...fresh, status: "SAVED_LOCAL", attempts, nextAttemptAt: now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] });
        }
        return false;
      });
      if (stop) return { sent, nextWakeAt: null };
    }
  }

  return {
    /** Save a count on the phone. The newest number for an item in an area replaces the older entry, even one being sent. */
    enqueue(command: SaveLineCommand): Promise<OutboxEntry> {
      return locked(async () => {
        const userId = getUserId();
        if (userId === null) throw new Error("You must be signed in to save a count.");
        const entries = await store.list();
        const t = now();
        await store.remove(entries.filter((e) => e.userId === userId && e.status === "ACCEPTED" && sameItem(e.command, command)).map((e) => e.id));

        const existing = entries.find((e) => e.userId === userId && (e.status === "SAVED_LOCAL" || e.status === "NEEDS_ATTENTION" || e.status === "SENDING") && sameItem(e.command, command));
        const entry: OutboxEntry = !existing
          ? { id: newId(), userId, status: "SAVED_LOCAL", command, attempts: 0, nextAttemptAt: 0, createdAt: t, updatedAt: t }
          : existing.status === "SENDING"
            ? { ...existing, command } // stays SENDING; its result sees the changed command and sends this one next
            : { ...existing, status: "SAVED_LOCAL", command, attempts: 0, nextAttemptAt: 0, attention: undefined };
        await put(entry);
        return entry;
      });
    },

    /** Send what is due, within the rate cap. Returns when to call again, or null when nothing is waiting. */
    drain(): Promise<{ sent: number; nextWakeAt: number | null }> {
      if (draining) {
        drainAgain = true; // something changed since the running pass looked: it must go round once more
        return draining;
      }
      draining = (async () => {
        let total = 0;
        let last: { sent: number; nextWakeAt: number | null };
        do {
          drainAgain = false;
          last = await runDrain();
          total += last.sent;
        } while (drainAgain);
        return { sent: total, nextWakeAt: last.nextWakeAt };
      })().finally(() => {
        draining = null;
      });
      return draining;
    },

    /** The chef chose "send again" on a stuck count. */
    retry(id: string) {
      return locked(async () => {
        const entry = await find(id);
        if (entry && entry.status === "NEEDS_ATTENTION") await put({ ...entry, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, attention: undefined });
      });
    },

    /** The chef confirmed throwing a count away. The entry stays as DISCARDED so the act is on record. */
    discard(id: string) {
      return locked(async () => {
        const entry = await find(id);
        if (entry && entry.status !== "ACCEPTED") await put({ ...entry, status: "DISCARDED" });
      });
    },

    /** App start: a count caught mid-send by a crash goes back in the queue (the server save is an upsert, so resending is safe). */
    recover() {
      return locked(async () => {
        for (const e of (await store.list()).filter((x) => x.status === "SENDING")) await put({ ...e, status: "SAVED_LOCAL" });
      });
    },

    /** After signing in again: counts parked because the session ended go back in the queue. */
    requeueSignedOut() {
      return locked(async () => {
        const userId = getUserId();
        for (const e of (await store.list()).filter((x) => x.userId === userId && x.status === "NEEDS_ATTENTION" && x.attention?.reason === "signed_out")) {
          await put({ ...e, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, attention: undefined });
        }
      });
    },

    /** Housekeeping: forget counts accepted longer ago than this. Waiting, stuck and discarded entries are never pruned. */
    pruneAccepted(olderThanMs: number) {
      return locked(async () => {
        const cutoff = now() - olderThanMs;
        await store.remove((await store.list()).filter((e) => e.status === "ACCEPTED" && e.updatedAt < cutoff).map((e) => e.id));
        notify();
      });
    },

    /** Every entry the signed-in account has for one area, oldest first (screens turn these into save states). */
    async entriesFor(sessionId: string, categoryName: string): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId === userId && e.command.sessionId === sessionId && e.command.categoryName === categoryName);
    },

    /** Every stuck count the signed-in account has, from any stock take (a closed one can still hold counts the chef must see). */
    async attention(): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId === userId && e.status === "NEEDS_ATTENTION");
    },

    /** Unsent counts that belong to a different account than the one signed in (shown as a notice). */
    async otherAccountPending(): Promise<number> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId !== userId && OPEN.includes(e.status)).length;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
