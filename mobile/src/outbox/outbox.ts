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
 * Storage is an adapter (SQLite on the phone, memory in tests); this module holds no state of its own
 * beyond the send timestamps for the rate cap.
 */

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

function classify(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return { kind: "retry" };
  switch (err.code) {
    case "unauthorized":
      return { kind: "stop" };
    case "forbidden":
      if (err.message.includes("claimed this category")) return { kind: "attention", reason: "not_yours", message: err.message };
      if (err.message.includes("earlier claim")) return { kind: "attention", reason: "claim_changed", message: err.message };
      return { kind: "attention", reason: "no_access", message: err.message };
    case "bad_request":
      return { kind: "attention", reason: /^Cannot count: category is/.test(err.message) ? "area_closed" : "rejected", message: err.message };
    case "not_found":
    case "conflict":
    case "upgrade_required":
      return { kind: "attention", reason: "rejected", message: err.message };
    default:
      return { kind: "retry" }; // network, timeout, server, rate_limited
  }
}

const sameItem = (a: SaveLineCommand, b: SaveLineCommand) => a.sessionId === b.sessionId && a.categoryName === b.categoryName && a.ingredientId === b.ingredientId;

export function createOutbox({ store, send, now, newId, getUserId }: OutboxDeps) {
  const listeners = new Set<() => void>();
  const sendTimes: number[] = [];
  let draining: Promise<{ sent: number; nextWakeAt: number | null }> | null = null;

  const notify = () => listeners.forEach((l) => l());
  async function put(entry: OutboxEntry) {
    await store.put({ ...entry, updatedAt: now() });
    notify();
  }

  async function runDrain(userId: number): Promise<{ sent: number; nextWakeAt: number | null }> {
    let sent = 0;
    for (;;) {
      const t = now();
      while (sendTimes.length > 0 && t - sendTimes[0] >= RATE_WINDOW_MS) sendTimes.shift();
      if (sendTimes.length >= RATE_CAP) return { sent, nextWakeAt: sendTimes[0] + RATE_WINDOW_MS };

      const mine = (await store.list()).filter((e) => e.userId === userId && e.status === "SAVED_LOCAL");
      const due = mine.find((e) => e.nextAttemptAt <= t);
      if (!due) return { sent, nextWakeAt: mine.length > 0 ? Math.min(...mine.map((e) => e.nextAttemptAt)) : null };

      await put({ ...due, status: "SENDING" });
      sendTimes.push(t);
      try {
        await send(due);
        await put({ ...due, status: "ACCEPTED", attention: undefined });
        sent++;
      } catch (err) {
        const outcome = classify(err);
        if (outcome.kind === "attention") {
          await put({ ...due, status: "NEEDS_ATTENTION", attempts: due.attempts + 1, attention: { reason: outcome.reason, message: outcome.message } });
        } else if (outcome.kind === "stop") {
          await put({ ...due, status: "NEEDS_ATTENTION", attempts: due.attempts + 1, attention: { reason: "signed_out", message: err instanceof Error ? err.message : "Your session has ended. Sign in again." } });
          return { sent, nextWakeAt: null };
        } else {
          const attempts = due.attempts + 1;
          await put({ ...due, status: "SAVED_LOCAL", attempts, nextAttemptAt: now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] });
        }
      }
    }
  }

  return {
    /** Save a count on the phone. The newest number for an item in an area replaces one that has not been sent. */
    async enqueue(command: SaveLineCommand): Promise<OutboxEntry> {
      const userId = getUserId();
      if (userId === null) throw new Error("You must be signed in to save a count.");
      const entries = await store.list();
      const t = now();
      await store.remove(entries.filter((e) => e.userId === userId && e.status === "ACCEPTED" && sameItem(e.command, command)).map((e) => e.id));

      const unsent = entries.find((e) => e.userId === userId && (e.status === "SAVED_LOCAL" || e.status === "NEEDS_ATTENTION") && sameItem(e.command, command));
      const entry: OutboxEntry = unsent
        ? { ...unsent, status: "SAVED_LOCAL", command, attempts: 0, nextAttemptAt: 0, attention: undefined }
        : { id: newId(), userId, status: "SAVED_LOCAL", command, attempts: 0, nextAttemptAt: 0, createdAt: t, updatedAt: t };
      await put(entry);
      return entry;
    },

    /** Send what is due, within the rate cap. Returns when to call again, or null when nothing is waiting. */
    drain(): Promise<{ sent: number; nextWakeAt: number | null }> {
      const userId = getUserId();
      if (userId === null) return Promise.resolve({ sent: 0, nextWakeAt: null });
      draining ??= runDrain(userId).finally(() => {
        draining = null;
      });
      return draining;
    },

    /** The chef chose "send again" on a stuck count. */
    async retry(id: string) {
      const entry = (await store.list()).find((e) => e.id === id);
      if (entry && entry.status === "NEEDS_ATTENTION") await put({ ...entry, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, attention: undefined });
    },

    /** The chef confirmed throwing a count away. The entry stays as DISCARDED so the act is on record. */
    async discard(id: string) {
      const entry = (await store.list()).find((e) => e.id === id);
      if (entry && entry.status !== "ACCEPTED") await put({ ...entry, status: "DISCARDED" });
    },

    /** App start: a count caught mid-send by a crash goes back in the queue (the server save is an upsert, so resending is safe). */
    async recover() {
      for (const e of (await store.list()).filter((x) => x.status === "SENDING")) await put({ ...e, status: "SAVED_LOCAL" });
    },

    /** Counts in this area that stop it being submitted: anything not yet accepted or discarded. */
    async unresolved(sessionId: string, categoryName: string): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId === userId && OPEN.includes(e.status) && e.command.sessionId === sessionId && e.command.categoryName === categoryName);
    },

    /** Every entry the signed-in account has for one area, oldest first (screens turn these into save states). */
    async entriesFor(sessionId: string, categoryName: string): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId === userId && e.command.sessionId === sessionId && e.command.categoryName === categoryName);
    },

    /** Unsent counts that belong to a different account than the one signed in (shown as a warning). */
    async otherAccountPending(): Promise<number> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId !== userId && OPEN.includes(e.status)).length;
    },

    async summary(): Promise<{ waiting: number; needsAttention: number; accepted: number }> {
      const mine = (await store.list()).filter((e) => e.userId === getUserId());
      return {
        waiting: mine.filter((e) => e.status === "SAVED_LOCAL" || e.status === "SENDING").length,
        needsAttention: mine.filter((e) => e.status === "NEEDS_ATTENTION").length,
        accepted: mine.filter((e) => e.status === "ACCEPTED").length,
      };
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
