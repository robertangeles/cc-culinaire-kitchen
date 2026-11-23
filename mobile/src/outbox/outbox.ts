/**
 * The phone's offline queue. A count (or any other command) is written here first ("Saved on this phone"), then
 * sent when it can be. The rules are the owner-approved offline rules for release 1:
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
 * Commands are typed. Each one is stored with its `type` and the `version` of its stored shape, and a
 * `CommandHandler` registered for that type says how to send it, which key it concerns, what a refusal means and
 * how a newer command folds into an unsent one. Counts are the built-in `count.saveLine` handler; other modules
 * (waste now, consumption, transfers and orders later) pass their handlers in `handlers`. Commands with the same
 * key are sent in the order they were saved: one waits for the one before it. An entry whose type or version this
 * build does not know is kept as "needs attention" (never dropped, never sent) until the app is updated.
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

export type AttentionReason =
  | "signed_out"
  | "not_yours"
  | "claim_changed"
  | "no_access"
  | "area_closed"
  | "rejected"
  /** The server kept failing on this command (its handler's limit): try again later or discard. */
  | "server_error"
  /** Saved by a newer version of the app, or a command this build has no handler for. */
  | "unsupported";

export interface OutboxEntry<C = SaveLineCommand> {
  id: string;
  userId: number;
  /** Which handler sends it, and the version of the stored command's shape. */
  type: string;
  version: number;
  status: OutboxStatus;
  command: C;
  attempts: number;
  /** Failures that were the server's own (5xx), for a handler's `maxServerFailures`. */
  serverFailures: number;
  /** Epoch ms; 0 means send as soon as possible. */
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  attention?: { reason: AttentionReason; message: string };
}

/** A store holds each entry's command as JSON whatever its type; the engine reads it back as the handler's type. */
export interface OutboxStore {
  /** Every entry, oldest first. */
  list(): Promise<OutboxEntry[]>;
  /** Insert, or replace the entry with the same id. */
  put(entry: OutboxEntry): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

export type Outcome =
  /** Done as far as the phone is concerned (the server already had it). */
  | { kind: "applied" }
  | { kind: "retry" }
  | { kind: "stop" }
  | { kind: "attention"; reason: AttentionReason; message: string };

/** How one type of command is sent and what the server's answers to it mean. */
export interface CommandHandler<C = unknown> {
  type: string;
  /** The shape version this build writes. Entries stored with a higher one are kept, not sent. */
  version: number;
  /** Commands with the same key concern the same thing and are sent in the order they were saved. Keys share one namespace: prefix yours. */
  key(command: C): string;
  /** Performs the request; throws ApiError on any failure. Must be safe to repeat (client-made ids). */
  send(command: C, entry: OutboxEntry<C>): Promise<void>;
  /** Turns a command stored under an older version into this version's shape. */
  upgrade?(command: unknown, fromVersion: number): C;
  /** A refusal that means "the server already has this" (a repeat of a delete, an already-confirmed receipt): counted as sent. */
  isApplied?(err: ApiError): boolean;
  /** This handler's reading of a failure; return undefined to use the default. */
  classify?(err: ApiError): Outcome | undefined;
  /** Stop retrying after this many server (5xx) failures and ask the person. Network failures never count: a dead network is not a reason to give up. */
  maxServerFailures?: number;
  /** Only the newest command for a key matters: it replaces an unsent older one and clears older accepted ones. */
  latestOnly?: boolean;
  /**
   * What saving `incoming` means when an older unsent command for the same key is waiting (`open`). Return the command
   * the waiting entry becomes (its type may change), "cancel" to drop it (the server never heard of it), or "append"
   * to queue after it. `mayBeOnServer` is true once the older one has been tried and not definitely refused (on the wire, or a
   * timeout, a 5xx, a lost reply, a crash): the server may already hold it, so only "append" is safe then.
   */
  fold?(open: { type: string; command: unknown }, incoming: C, mayBeOnServer: boolean): { type: string; command: unknown } | "cancel" | "append";
  /** A short line for the sync list; a handler without it is not listed there (counts have their own screen). */
  describe?(command: C): string;
}

export interface OutboxDeps {
  store: OutboxStore;
  /** Performs the request for a queued count (the built-in `count.saveLine` handler); throws ApiError on any failure. */
  send: (entry: OutboxEntry) => Promise<void>;
  /** Handlers for every other type of command. */
  handlers?: CommandHandler<unknown>[];
  now: () => number;
  newId: () => string;
  /** The signed-in account, or null. */
  getUserId: () => number | null;
}

const RATE_CAP = 20;
const RATE_WINDOW_MS = 60_000;
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000];
const OPEN: OutboxStatus[] = ["SAVED_LOCAL", "SENDING", "NEEDS_ATTENTION"];

export const COUNT_TYPE = "count.saveLine";

/** What a failure means for a command whose handler has no opinion. The server's code decides; the English text is only detail. */
export function defaultClassify(err: unknown): Outcome {
  if (!(err instanceof ApiError)) return { kind: "retry" };
  switch (err.code) {
    case "unauthorized":
      return { kind: "stop" };
    case "forbidden":
      return { kind: "attention", reason: "no_access", message: err.message };
    case "bad_request":
    case "not_found":
    case "conflict":
    case "upgrade_required":
    case "bad_response":
      return { kind: "attention", reason: "rejected", message: err.message };
    default:
      return { kind: "retry" }; // network, timeout, server, rate_limited
  }
}

/** The server's code decides; the English text is the fallback until every server sends codes. */
function classifyCount(err: ApiError): Outcome | undefined {
  switch (err.code) {
    case "forbidden":
      if (err.hasCode(STOCK_TAKE_CODES.claimedByOther) || err.message.includes("claimed this category")) return { kind: "attention", reason: "not_yours", message: err.message };
      if (err.hasCode(STOCK_TAKE_CODES.claimChanged) || err.message.includes("earlier claim")) return { kind: "attention", reason: "claim_changed", message: err.message };
      return { kind: "attention", reason: "no_access", message: err.message };
    case "bad_request":
      return { kind: "attention", reason: err.hasCode(STOCK_TAKE_CODES.areaClosed) || /^Cannot count: category is/.test(err.message) ? "area_closed" : "rejected", message: err.message };
    default:
      return undefined;
  }
}

const sameCommand = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createOutbox({ store, send, handlers = [], now, newId, getUserId }: OutboxDeps) {
  const registry = new Map<string, CommandHandler<unknown>>();
  registry.set(COUNT_TYPE, {
    type: COUNT_TYPE,
    version: 1,
    key: (c) => { const { sessionId, categoryName, ingredientId } = c as SaveLineCommand; return `count:${sessionId}|${categoryName}|${ingredientId}`; },
    // One entry per item in an area: a newer number replaces the older command, even while it is being sent.
    latestOnly: true,
    send: (_c, entry) => send(entry as OutboxEntry),
    classify: classifyCount,
  } as CommandHandler<unknown>);
  for (const h of handlers) registry.set(h.type, h);

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
  async function put(entry: OutboxEntry<unknown>) {
    await store.put({ ...entry, updatedAt: now() } as OutboxEntry);
    notify();
  }
  const find = async (id: string) => (await store.list()).find((e) => e.id === id);

  /** A key for an entry; an entry nobody can read is its own group, so it never holds back another's. */
  const keyOf = (e: OutboxEntry<unknown>) => registry.get(e.type)?.key(e.command) ?? `unknown:${e.id}`;
  const isSupported = (e: OutboxEntry<unknown>) => {
    const h = registry.get(e.type);
    return !!h && e.version <= h.version;
  };

  /** One pass: send what is due for the signed-in account, within the rate cap. */
  async function runDrain(): Promise<{ sent: number; nextWakeAt: number | null }> {
    let sent = 0;
    for (;;) {
      const userId = getUserId();
      if (userId === null) return { sent, nextWakeAt: null };

      const t = now();
      while (sendTimes.length > 0 && t - sendTimes[0] >= RATE_WINDOW_MS) sendTimes.shift();
      if (sendTimes.length >= RATE_CAP) return { sent, nextWakeAt: sendTimes[0] + RATE_WINDOW_MS };

      // Pick the next due entry and mark it SENDING. An entry waits for every earlier open entry with its key.
      const picked = await locked(async () => {
        const held = new Set<string>();
        const wakes: number[] = [];
        let due: OutboxEntry<unknown> | undefined;
        for (const e of (await store.list()) as OutboxEntry<unknown>[]) {
          if (e.userId !== userId || !OPEN.includes(e.status)) continue;
          const key = keyOf(e);
          if (e.status === "SAVED_LOCAL" && !held.has(key)) {
            if (!isSupported(e)) {
              await put({ ...e, status: "NEEDS_ATTENTION", attention: { reason: "unsupported", message: "This was saved by a newer version of the app. Update the app and it will be sent." } });
              held.add(key);
              continue;
            }
            if (e.nextAttemptAt <= t) due ??= e;
            else wakes.push(e.nextAttemptAt);
          }
          held.add(key);
        }
        if (!due) return { nextWakeAt: wakes.length > 0 ? Math.min(...wakes) : null };
        const entry = { ...due, status: "SENDING" as const };
        await put(entry);
        return { entry };
      });
      if (!picked.entry) return { sent, nextWakeAt: picked.nextWakeAt };
      const entry = picked.entry;
      const handler = registry.get(entry.type)!;

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
        const command = entry.version < handler.version && handler.upgrade ? handler.upgrade(entry.command, entry.version) : entry.command;
        await handler.send(command, { ...entry, command });
      } catch (err) {
        failure = err;
      }

      // Apply the result to the entry as it is NOW.
      const stop = await locked(async () => {
        const fresh = await find(entry.id);
        if (!fresh || fresh.status !== "SENDING") return false; // discarded or reset meanwhile: leave it as it is
        if (!sameCommand(fresh.command, entry.command)) {
          // A newer number arrived while this one was in flight. Whatever happened to the old one, send the new one next.
          await put({ ...fresh, status: "SAVED_LOCAL", attempts: 0, serverFailures: 0, nextAttemptAt: 0, attention: undefined });
          return false;
        }
        const outcome: Outcome =
          failure === null || (failure instanceof ApiError && handler.isApplied?.(failure))
            ? { kind: "applied" }
            : ((failure instanceof ApiError ? handler.classify?.(failure) : undefined) ?? defaultClassify(failure));
        if (outcome.kind === "applied") {
          await put({ ...fresh, status: "ACCEPTED", attention: undefined });
          sent++;
          return false;
        }
        if (outcome.kind === "attention") {
          await put({ ...fresh, status: "NEEDS_ATTENTION", attempts: fresh.attempts + 1, attention: { reason: outcome.reason, message: outcome.message } });
        } else if (outcome.kind === "stop") {
          await put({ ...fresh, status: "NEEDS_ATTENTION", attempts: fresh.attempts + 1, attention: { reason: "signed_out", message: failure instanceof Error ? failure.message : "Your session has ended. Sign in again." } });
          return true;
        } else {
          const attempts = fresh.attempts + 1;
          const serverFailures = fresh.serverFailures + (failure instanceof ApiError && failure.code === "server" ? 1 : 0);
          if (handler.maxServerFailures !== undefined && serverFailures >= handler.maxServerFailures) {
            await put({ ...fresh, status: "NEEDS_ATTENTION", attempts, serverFailures, attention: { reason: "server_error", message: "The server could not save this after several tries." } });
          } else {
            await put({ ...fresh, status: "SAVED_LOCAL", attempts, serverFailures, nextAttemptAt: now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] });
          }
        }
        return false;
      });
      if (stop) return { sent, nextWakeAt: null };
    }
  }

  const fresh = (e: Pick<OutboxEntry<unknown>, "id" | "userId" | "createdAt">, h: CommandHandler<unknown>, command: unknown, t: number): OutboxEntry<unknown> => ({
    id: e.id, userId: e.userId, createdAt: e.createdAt, type: h.type, version: h.version, status: "SAVED_LOCAL", command, attempts: 0, serverFailures: 0, nextAttemptAt: 0, updatedAt: t,
  });

  /** Save a command on the phone. Returns the entry, or null when it cancelled an unsent one (so nothing needs sending). */
  function enqueueCommand<C>(type: string, command: C): Promise<OutboxEntry<C> | null> {
    return locked(async () => {
      const userId = getUserId();
      if (userId === null) throw new Error("You must be signed in to save this.");
      const handler = registry.get(type);
      if (!handler) throw new Error(`Unknown command type ${type}`);
      const key = handler.key(command);
      const entries = ((await store.list()) as OutboxEntry<unknown>[]).filter((e) => e.userId === userId && registry.has(e.type) && keyOf(e) === key);
      const t = now();
      if (handler.latestOnly) await store.remove(entries.filter((e) => e.status === "ACCEPTED").map((e) => e.id));

      const existing = entries.filter((e) => OPEN.includes(e.status)).at(-1);
      const append = async () => {
        const entry = fresh({ id: newId(), userId, createdAt: t }, handler, command, t);
        await put(entry);
        return entry as OutboxEntry<C>;
      };
      if (!existing) return append();

      const sending = existing.status === "SENDING";
      const mayBeOnServer = sending || (existing.status === "SAVED_LOCAL" && existing.attempts > 0) || existing.attention?.reason === "server_error";
      const folded = handler.fold ? handler.fold({ type: existing.type, command: existing.command }, command, mayBeOnServer) : handler.latestOnly ? { type, command } : "append";
      if (folded === "append") return append();
      if (folded === "cancel") {
        await store.remove([existing.id]);
        notify();
        return null;
      }
      const next = registry.get(folded.type) ?? handler;
      // A command on the wire keeps its place (its result sees the changed command and sends the new one next); an unsent one starts over.
      const entry: OutboxEntry<unknown> = sending ? { ...existing, command: folded.command } : fresh(existing, next, folded.command, t);
      await put({ ...entry, createdAt: existing.createdAt });
      return entry as OutboxEntry<C>;
    });
  }

  return {
    enqueueCommand,

    /** Save a count on the phone. The newest number for an item in an area replaces the older entry, even one being sent. */
    async enqueue(command: SaveLineCommand): Promise<OutboxEntry> {
      return (await enqueueCommand(COUNT_TYPE, command))!;
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

    /** The person chose "send again" on a stuck command. */
    retry(id: string) {
      return locked(async () => {
        const entry = await find(id);
        if (entry && entry.status === "NEEDS_ATTENTION") await put({ ...entry, status: "SAVED_LOCAL", attempts: 0, serverFailures: 0, nextAttemptAt: 0, attention: undefined });
      });
    },

    /** The person confirmed throwing a command away. The entry stays as DISCARDED so the act is on record. */
    discard(id: string) {
      return locked(async () => {
        const entry = await find(id);
        if (entry && entry.status !== "ACCEPTED") await put({ ...entry, status: "DISCARDED" });
      });
    },

    /** App start: a command caught mid-send by a crash goes back in the queue (every send is safe to repeat), and so does one a newer app left unread. */
    recover() {
      return locked(async () => {
        for (const e of (await store.list()).filter((x) => x.status === "SENDING" || (x.status === "NEEDS_ATTENTION" && x.attention?.reason === "unsupported"))) {
          await put({ ...e, status: "SAVED_LOCAL", attention: undefined, attempts: e.status === "SENDING" ? e.attempts + 1 : e.attempts });
        }
      });
    },

    /** After signing in again: commands parked because the session ended go back in the queue. */
    requeueSignedOut() {
      return locked(async () => {
        const userId = getUserId();
        for (const e of (await store.list()).filter((x) => x.userId === userId && x.status === "NEEDS_ATTENTION" && x.attention?.reason === "signed_out")) {
          await put({ ...e, status: "SAVED_LOCAL", attempts: 0, serverFailures: 0, nextAttemptAt: 0, attention: undefined });
        }
      });
    },

    /** Housekeeping: forget commands accepted longer ago than this. Waiting, stuck and discarded entries are never pruned. */
    pruneAccepted(olderThanMs: number) {
      return locked(async () => {
        const cutoff = now() - olderThanMs;
        await store.remove((await store.list()).filter((e) => e.status === "ACCEPTED" && e.updatedAt < cutoff).map((e) => e.id));
        notify();
      });
    },

    /** Every entry of these types the signed-in account has that is waiting, being sent or stuck, oldest first. */
    async open(types: string[]): Promise<OutboxEntry<unknown>[]> {
      const userId = getUserId();
      return ((await store.list()) as OutboxEntry<unknown>[]).filter((e) => e.userId === userId && types.includes(e.type) && OPEN.includes(e.status));
    },

    /** Every entry of these types the signed-in account has, accepted ones included (a screen shows what just synced). */
    async entriesOfTypes(types: string[]): Promise<OutboxEntry<unknown>[]> {
      const userId = getUserId();
      return ((await store.list()) as OutboxEntry<unknown>[]).filter((e) => e.userId === userId && types.includes(e.type) && e.status !== "DISCARDED");
    },

    /** The text for one entry in the sync list, from its handler; null when its handler lists nothing (counts have their own screen). */
    describe(entry: OutboxEntry<unknown>): string | null {
      return registry.get(entry.type)?.describe?.(entry.command) ?? null;
    },

    /** Every entry the signed-in account has for one area, oldest first (screens turn these into save states). */
    async entriesFor(sessionId: string, categoryName: string): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return ((await store.list()) as OutboxEntry[]).filter((e) => e.userId === userId && e.type === COUNT_TYPE && e.command.sessionId === sessionId && e.command.categoryName === categoryName);
    },

    /** Every stuck count the signed-in account has, from any stock take (a closed one can still hold counts the chef must see). */
    async attention(): Promise<OutboxEntry[]> {
      const userId = getUserId();
      return ((await store.list()) as OutboxEntry[]).filter((e) => e.userId === userId && e.type === COUNT_TYPE && e.status === "NEEDS_ATTENTION");
    },

    /** Unsent counts (not other commands) that belong to a different account than the one signed in (shown as a notice). */
    async otherAccountPending(): Promise<number> {
      const userId = getUserId();
      return (await store.list()).filter((e) => e.userId !== userId && e.type === COUNT_TYPE && OPEN.includes(e.status)).length;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
