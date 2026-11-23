import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore, type SaveLineCommand } from "./outbox";
import { ApiError } from "../api/client";

function memoryStore(): OutboxStore & { rows: Map<string, OutboxEntry> } {
  const rows = new Map<string, OutboxEntry>();
  return {
    rows,
    list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    put: async (e) => void rows.set(e.id, { ...e }),
    remove: async (ids) => ids.forEach((id) => rows.delete(id)),
  };
}

const line = (over: Partial<SaveLineCommand> = {}): SaveLineCommand => ({
  sessionId: "S1",
  categoryName: "Bar",
  ingredientId: "i1",
  ingredientName: "Shiraz",
  rawQty: 3,
  countedUnit: "kg",
  claimRevision: 1,
  ...over,
});

function setup(sendImpl: (e: OutboxEntry) => Promise<void> = async () => {}, userId: number | null = 1) {
  const clock = { t: 1_000_000 };
  const store = memoryStore();
  const send = vi.fn(sendImpl);
  let n = 0;
  const outbox = createOutbox({ store, send, now: () => clock.t, newId: () => `id${++n}`, getUserId: () => userId });
  return { outbox, store, send, clock, rows: () => [...store.rows.values()] };
}

describe("enqueue", () => {
  it("saves a count on the phone first, bound to the signed-in account", async () => {
    const { outbox, rows } = setup();
    await outbox.enqueue(line());
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", userId: 1, attempts: 0, command: { rawQty: 3, ingredientName: "Shiraz" } });
  });

  it("refuses to queue when nobody is signed in", async () => {
    const { outbox } = setup(async () => {}, null);
    await expect(outbox.enqueue(line())).rejects.toThrow(/signed in/);
  });

  it("keeps one entry per item in an area: the newest number replaces an unsent one", async () => {
    const { outbox, rows } = setup();
    await outbox.enqueue(line({ rawQty: 3 }));
    await outbox.enqueue(line({ rawQty: 5 }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].command.rawQty).toBe(5);
    await outbox.enqueue(line({ ingredientId: "i2", ingredientName: "Flour" }));
    expect(rows()).toHaveLength(2);
  });

  it("a newer number for an item that is being sent replaces it in the same entry, so the old send cannot win", async () => {
    const { outbox, store, rows } = setup();
    await outbox.enqueue(line({ rawQty: 3 }));
    const [first] = rows();
    await store.put({ ...first, status: "SENDING" });
    await outbox.enqueue(line({ rawQty: 4 }));
    expect(rows().map((r) => [r.status, r.command.rawQty])).toEqual([["SENDING", 4]]);
  });

  it("editing a stuck count puts it back in the queue with the new number", async () => {
    const { outbox, rows } = setup(async () => { throw new ApiError("bad_request", "Cannot count: category is SUBMITTED", 400); });
    await outbox.enqueue(line({ rawQty: 3 }));
    await outbox.drain();
    expect(rows()[0].status).toBe("NEEDS_ATTENTION");
    await outbox.enqueue(line({ rawQty: 9 }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 0, command: { rawQty: 9 } });
  });
});

describe("drain: accepted, retry and backoff", () => {
  it("sends in the order counted and marks each accepted", async () => {
    const { outbox, send, rows, clock } = setup();
    await outbox.enqueue(line({ ingredientId: "i1" }));
    clock.t += 10;
    await outbox.enqueue(line({ ingredientId: "i2" }));
    const result = await outbox.drain();
    expect(send.mock.calls.map(([e]) => e.command.ingredientId)).toEqual(["i1", "i2"]);
    expect(rows().map((r) => r.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    expect(result.sent).toBe(2);
  });

  it.each([
    ["network", new ApiError("network")],
    ["timeout", new ApiError("timeout")],
    ["server error", new ApiError("server", undefined, 503)],
    ["rate limit", new ApiError("rate_limited", undefined, 429)],
    ["an unexpected error", new Error("boom")],
  ])("keeps the count and retries later after %s", async (_n, err) => {
    const { outbox, rows, send, clock } = setup(async () => { throw err; });
    await outbox.enqueue(line());
    await outbox.drain();
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 1, nextAttemptAt: clock.t + 5_000 });

    await outbox.drain(); // too early: not sent again
    expect(send).toHaveBeenCalledTimes(1);

    clock.t += 5_000;
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("backs off 5s, 15s, 60s, then every 5 minutes", async () => {
    const { outbox, rows, clock } = setup(async () => { throw new ApiError("network"); });
    await outbox.enqueue(line());
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      await outbox.drain();
      gaps.push(rows()[0].nextAttemptAt - clock.t);
      clock.t = rows()[0].nextAttemptAt;
    }
    expect(gaps).toEqual([5_000, 15_000, 60_000, 300_000, 300_000]);
  });

  it("a retry that finally works is accepted", async () => {
    let fail = true;
    const { outbox, rows, clock } = setup(async () => { if (fail) throw new ApiError("network"); });
    await outbox.enqueue(line());
    await outbox.drain();
    fail = false;
    clock.t += 5_000;
    await outbox.drain();
    expect(rows()[0].status).toBe("ACCEPTED");
  });
});

describe("drain: refusals are kept and shown, never dropped", () => {
  const cases: Array<[string, ApiError, string]> = [
    ["another chef holds the area", new ApiError("forbidden", "Only the person who claimed this category can count or submit it", 403), "not_yours"],
    ["the claim changed", new ApiError("forbidden", "This count was queued under an earlier claim; recount under the current claim", 403), "claim_changed"],
    ["any other 403", new ApiError("forbidden", "You don't have access to that.", 403), "no_access"],
    ["the area is already submitted", new ApiError("bad_request", "Cannot count: category is SUBMITTED", 400), "area_closed"],
    ["a validation failure", new ApiError("bad_request", "Quantity cannot exceed 99,999", 400), "rejected"],
    ["the area is gone", new ApiError("not_found", 'Category "Bar" not found', 404), "rejected"],
    ["a conflict", new ApiError("conflict", "Something changed", 409), "rejected"],
    // The server's code decides, whatever the wording.
    ["another chef holds the area (code)", new ApiError("forbidden", "Not yours", 403, undefined, "STOCK_TAKE_CLAIMED_BY_OTHER"), "not_yours"],
    ["the claim changed (code)", new ApiError("forbidden", "Recount", 403, undefined, "STOCK_TAKE_CLAIM_CHANGED"), "claim_changed"],
    ["the area is closed (code)", new ApiError("bad_request", "Too late", 400, undefined, "STOCK_TAKE_AREA_CLOSED"), "area_closed"],
  ];
  it.each(cases)("marks the count needs-attention when %s, with the server's message", async (_n, err, reason) => {
    const { outbox, rows } = setup(async () => { throw err; });
    await outbox.enqueue(line());
    await outbox.drain();
    expect(rows()[0]).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason, message: err.message }, command: { rawQty: 3 } });
  });

  it("does not resend a stuck count by itself, and carries on with the next one", async () => {
    const { outbox, rows, send, clock } = setup(async (e) => { if (e.command.ingredientId === "i1") throw new ApiError("bad_request", "Cannot count: category is SUBMITTED", 400); });
    await outbox.enqueue(line({ ingredientId: "i1" }));
    clock.t += 1;
    await outbox.enqueue(line({ ingredientId: "i2" }));
    await outbox.drain();
    expect(rows().map((r) => r.status)).toEqual(["NEEDS_ATTENTION", "ACCEPTED"]);
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops draining when the session has ended, keeping every count", async () => {
    const { outbox, rows, send, clock } = setup(async () => { throw new ApiError("unauthorized"); });
    await outbox.enqueue(line({ ingredientId: "i1" }));
    clock.t += 1;
    await outbox.enqueue(line({ ingredientId: "i2" }));
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows().map((r) => [r.status, r.attention?.reason])).toEqual([["NEEDS_ATTENTION", "signed_out"], ["SAVED_LOCAL", undefined]]);
  });

  it("retry puts a stuck count back in the queue; discard keeps a record of it", async () => {
    const { outbox, rows } = setup(async () => { throw new ApiError("forbidden", "Only the person who claimed this category can count or submit it", 403); });
    await outbox.enqueue(line());
    await outbox.drain();
    const id = rows()[0].id;
    await outbox.retry(id);
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0 });
    await outbox.drain();
    await outbox.discard(id);
    expect(rows()[0]).toMatchObject({ status: "DISCARDED", command: { ingredientName: "Shiraz", rawQty: 3 } });
  });
});

describe("drain cap", () => {
  it("sends at most 20 a minute and says when to come back for the rest", async () => {
    const { outbox, send, clock, rows } = setup();
    for (let i = 0; i < 25; i++) {
      clock.t += 1;
      await outbox.enqueue(line({ ingredientId: `i${i}` }));
    }
    const first = await outbox.drain();
    expect(first.sent).toBe(20);
    expect(first.nextWakeAt).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(20);

    clock.t = first.nextWakeAt!;
    const second = await outbox.drain();
    expect(second.sent).toBe(5);
    expect(rows().every((r) => r.status === "ACCEPTED")).toBe(true);
  });

  it("reports the next retry time when everything left is waiting out a backoff", async () => {
    const { outbox, clock } = setup(async () => { throw new ApiError("network"); });
    await outbox.enqueue(line());
    const out = await outbox.drain();
    expect(out.nextWakeAt).toBe(clock.t + 5_000);
  });
});

describe("recovery, accounts and submit gating", () => {
  it("puts counts that were mid-send when the app was killed back in the queue", async () => {
    const { outbox, store, rows } = setup();
    await outbox.enqueue(line());
    await store.put({ ...rows()[0], status: "SENDING" });
    await outbox.recover();
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 1 });
  });

  it("only sends the signed-in account's counts and reports the rest", async () => {
    const a = setup(async () => {}, 1);
    await a.outbox.enqueue(line());
    // A different chef signs in on the same phone.
    let user = 2;
    const outbox2 = createOutbox({ store: a.store, send: a.send, now: () => a.clock.t, newId: () => "x", getUserId: () => user });
    await outbox2.drain();
    expect(a.send).not.toHaveBeenCalled();
    expect(await outbox2.otherAccountPending()).toBe(1);
    user = 1;
    await outbox2.drain();
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(await outbox2.otherAccountPending()).toBe(0);
  });

  it("the notice for another account's counts does not count its other commands", async () => {
    const a = setup(async () => {}, 1);
    const handlers = [{ type: "note.save", version: 1, key: () => "n", send: async () => {} }];
    let n = 0;
    const first = createOutbox({ store: a.store, send: a.send, handlers, now: () => a.clock.t, newId: () => `n${++n}`, getUserId: () => 1 });
    await first.enqueueCommand("note.save", {});
    await first.enqueue(line());
    const second = createOutbox({ store: a.store, send: a.send, handlers, now: () => a.clock.t, newId: () => "x", getUserId: () => 2 });
    expect(await second.otherAccountPending()).toBe(1);
  });

  it("lists one area's entries for the signed-in account only", async () => {
    const { outbox } = setup();
    await outbox.enqueue(line({ ingredientId: "a" }));
    await outbox.enqueue(line({ ingredientId: "b", categoryName: "Kitchen" }));
    expect((await outbox.entriesFor("S1", "Bar")).map((e) => e.command.ingredientId)).toEqual(["a"]);
    expect(await outbox.entriesFor("S2", "Bar")).toEqual([]);
  });

  it("lists every stuck count of the signed-in account, from any stock take", async () => {
    const { outbox } = setup(async () => { throw new ApiError("bad_request", "Cannot count: category is SUBMITTED", 400); });
    await outbox.enqueue(line({ sessionId: "OLD", ingredientId: "a" }));
    await outbox.enqueue(line({ sessionId: "S1", ingredientId: "b" }));
    await outbox.drain();
    expect((await outbox.attention()).map((e) => e.command.sessionId).sort()).toEqual(["OLD", "S1"]);
  });

  it("puts counts that were parked because the session ended back in the queue after signing in again", async () => {
    let fail = true;
    const { outbox, rows, clock } = setup(async () => { if (fail) throw new ApiError("unauthorized"); });
    await outbox.enqueue(line({ ingredientId: "a" }));
    await outbox.enqueue(line({ ingredientId: "b" }));
    await outbox.drain();
    await outbox.enqueue(line({ ingredientId: "c" })); // a stuck-for-another-reason count must NOT be requeued
    fail = false;
    await outbox.requeueSignedOut();
    expect(rows().filter((r) => r.attention?.reason === "signed_out")).toEqual([]);
    clock.t += 1;
    const out = await outbox.drain();
    expect(out.sent).toBe(3);
  });
});

describe("pruning", () => {
  it("removes counts accepted more than the given time ago, and keeps everything else (including discard records)", async () => {
    const { outbox, rows, clock, store } = setup();
    await outbox.enqueue(line({ ingredientId: "old" }));
    await outbox.enqueue(line({ ingredientId: "recent" }));
    await outbox.enqueue(line({ ingredientId: "waiting" }));
    await outbox.enqueue(line({ ingredientId: "dropped" }));
    const byItem = (id: string) => rows().find((r) => r.command.ingredientId === id)!;
    await store.put({ ...byItem("old"), status: "ACCEPTED", updatedAt: clock.t - 8 * 86_400_000 });
    await store.put({ ...byItem("recent"), status: "ACCEPTED", updatedAt: clock.t - 1 * 86_400_000 });
    await store.put({ ...byItem("dropped"), status: "DISCARDED", updatedAt: clock.t - 90 * 86_400_000 });

    await outbox.pruneAccepted(7 * 86_400_000);
    expect(rows().map((r) => r.command.ingredientId).sort()).toEqual(["dropped", "recent", "waiting"]);
  });
});

describe("races between saving and sending (found in review)", () => {
  /** A send that waits until the test lets it finish, so we can act while it is in flight. */
  function gated() {
    const sent: number[] = [];
    let release: Array<() => void> = [];
    let failNext: Error | null = null;
    const send = async (e: OutboxEntry) => {
      sent.push(e.command.rawQty);
      await new Promise<void>((r) => release.push(r));
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
    };
    return { send, sent, finish: () => { const r = release; release = []; r.forEach((f) => f()); }, failNext: (e: Error) => void (failNext = e) };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("changing a count while it is being sent still ends with the new number sent and accepted", async () => {
    const g = gated();
    const { outbox, rows } = setup(g.send);
    await outbox.enqueue(line({ rawQty: 1 }));
    const draining = outbox.drain();
    await tick();
    await outbox.enqueue(line({ rawQty: 2 })); // the chef edits while the 1 is in flight
    g.finish();
    await tick();
    g.finish();
    await draining;
    expect(g.sent).toEqual([1, 2]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "ACCEPTED", command: { rawQty: 2 } });
  });

  it("an old send that fails never comes back to overwrite the newer number", async () => {
    const g = gated();
    const { outbox, rows, clock } = setup(g.send);
    await outbox.enqueue(line({ rawQty: 1 }));
    const draining = outbox.drain();
    await tick();
    await outbox.enqueue(line({ rawQty: 2 }));
    g.failNext(new ApiError("network"));
    g.finish();
    await tick();
    g.finish();
    await draining;
    expect(g.sent).toEqual([1, 2]); // never [1, 2, 1]
    clock.t += 10 * 60_000;
    g.finish();
    await outbox.drain();
    expect(rows()[0]).toMatchObject({ status: "ACCEPTED", command: { rawQty: 2 } });
  });

  it("discarding a count that is being sent stays discarded when the send finishes", async () => {
    const g = gated();
    const { outbox, rows } = setup(g.send);
    const entry = await outbox.enqueue(line({ rawQty: 1 }));
    const draining = outbox.drain();
    await tick();
    await outbox.discard(entry.id);
    g.finish();
    await draining;
    expect(rows()[0].status).toBe("DISCARDED");
  });

  it("a drain asked for while one is finishing still picks up the count saved in between", async () => {
    const g = gated();
    const { outbox, rows, clock } = setup(g.send);
    await outbox.enqueue(line({ ingredientId: "a" }));
    const first = outbox.drain();
    await tick();
    clock.t += 1;
    await outbox.enqueue(line({ ingredientId: "b" }));
    const second = outbox.drain(); // joins the running drain, which must go round again
    g.finish();
    await tick();
    g.finish();
    await Promise.all([first, second]);
    expect(rows().map((r) => r.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  });

  it("stops sending the first account's counts when a different account signs in mid-drain", async () => {
    const g = gated();
    let user = 1;
    const store = memoryStore();
    const clock = { t: 5_000 };
    let n = 0;
    const outbox = createOutbox({ store, send: g.send, now: () => clock.t, newId: () => `id${++n}`, getUserId: () => user });
    await outbox.enqueue(line({ ingredientId: "a" }));
    clock.t += 1;
    await outbox.enqueue(line({ ingredientId: "b" }));
    const draining = outbox.drain();
    await tick();
    user = 2; // someone else signs in while the first send is in flight
    g.finish();
    await draining;
    expect(g.sent).toHaveLength(1);
    const left = [...store.rows.values()].find((r) => r.command.ingredientId === "b")!;
    expect(left).toMatchObject({ userId: 1, status: "SAVED_LOCAL" });
  });
});

