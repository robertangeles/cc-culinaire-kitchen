import { describe, it, expect, vi } from "vitest";
import { createOutbox, type CommandHandler, type OutboxEntry, type OutboxStore } from "./outbox";
import { ApiError } from "../api/client";

function memoryStore(): OutboxStore & { rows: Map<string, OutboxEntry<unknown>> } {
  const rows = new Map<string, OutboxEntry<unknown>>();
  return {
    rows,
    list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) as OutboxEntry[],
    put: async (e) => void rows.set(e.id, { ...e }),
    remove: async (ids) => ids.forEach((id) => rows.delete(id)),
  };
}

const raw = (e: Partial<OutboxEntry<unknown>> & Pick<OutboxEntry<unknown>, "id" | "type" | "version" | "command" | "createdAt">): OutboxEntry<unknown> => ({ userId: 1, status: "SAVED_LOCAL", attempts: 0, serverFailures: 0, nextAttemptAt: 0, updatedAt: 1, ...e });

interface Note { id: string; text: string }

/** A made-up command: "note" create, with a `latest wins` edit that folds into an unsent create. */
const noteHandler = (over: Partial<CommandHandler<Note>> = {}): CommandHandler<Note> => ({
  type: "note.save",
  version: 1,
  key: (c) => `note:${c.id}`,
  send: async () => {},
  describe: (c) => `Note ${c.text}`,
  ...over,
});

function setup(handler: CommandHandler<Note>, userId: number | null = 1) {
  const clock = { t: 1_000_000 };
  const store = memoryStore();
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: [handler as CommandHandler<unknown>], now: () => clock.t, newId: () => `id${String(++n).padStart(2, "0")}`, getUserId: () => userId });
  return { outbox, store, clock, rows: () => [...store.rows.values()] };
}

describe("typed commands", () => {
  it("stores the command's type and version and sends it through its own handler", async () => {
    const send = vi.fn(async () => {});
    const { outbox, rows } = setup(noteHandler({ send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    expect(rows()[0]).toMatchObject({ type: "note.save", version: 1, status: "SAVED_LOCAL" });
    await outbox.drain();
    expect(send).toHaveBeenCalledWith({ id: "n1", text: "a" }, expect.objectContaining({ type: "note.save" }));
    expect(rows()[0].status).toBe("ACCEPTED");
  });

  it("refuses a type nobody registered, and an entry from a newer app is kept for the person, never dropped or sent", async () => {
    const { outbox, store, rows } = setup(noteHandler());
    await expect(outbox.enqueueCommand("nope", {})).rejects.toThrow(/Unknown command/);
    store.rows.set("future", raw({ id: "future", type: "note.save", version: 9, command: { id: "n9", text: "x" }, createdAt: 1 }));
    store.rows.set("alien", raw({ id: "alien", type: "alien.thing", version: 1, command: {}, createdAt: 2 }));
    await outbox.drain();
    expect(rows().map((r) => [r.id, r.status, r.attention?.reason])).toEqual([["future", "NEEDS_ATTENTION", "unsupported"], ["alien", "NEEDS_ATTENTION", "unsupported"]]);
    // After the app is updated, recover() gives them another look.
    await outbox.recover();
    expect(rows().every((r) => r.status === "SAVED_LOCAL")).toBe(true);
  });

  it("upgrades an older stored shape before sending it", async () => {
    const send = vi.fn(async () => {});
    const { outbox, store } = setup(noteHandler({ version: 2, send, upgrade: (c, from) => (from === 1 ? { ...(c as Note), text: `${(c as Note).text}!` } : (c as Note)) }));
    store.rows.set("old", raw({ id: "old", type: "note.save", version: 1, command: { id: "n1", text: "hi" }, createdAt: 1 }));
    await outbox.drain();
    expect(send).toHaveBeenCalledWith({ id: "n1", text: "hi!" }, expect.anything());
  });
});

describe("ordered replay", () => {
  it("sends commands about the same thing in the order they were saved, one waiting for the one before it", async () => {
    const seen: string[] = [];
    const send = vi.fn(async (c: Note) => {
      seen.push(c.text);
      if (c.text === "first" && seen.length === 1) throw new ApiError("network");
    });
    const { outbox, clock } = setup(noteHandler({ send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "first" });
    await outbox.enqueueCommand("note.save", { id: "n1", text: "second" });
    await outbox.enqueueCommand("note.save", { id: "n2", text: "other" });
    const r = await outbox.drain();
    // n1's first send failed on the network: n1's second must not overtake it, an unrelated note may go.
    expect(seen).toEqual(["first", "other"]);
    expect(r.nextWakeAt).toBe(clock.t + 5_000);
    clock.t += 5_000;
    await outbox.drain();
    expect(seen).toEqual(["first", "other", "first", "second"]);
  });

  it("a command that needs attention holds back the later ones for the same thing until it is dealt with", async () => {
    const send = vi.fn(async (c: Note) => {
      if (c.text === "bad") throw new ApiError("bad_request", "No", 400);
    });
    const { outbox, rows } = setup(noteHandler({ send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "bad" });
    await outbox.enqueueCommand("note.save", { id: "n1", text: "after" });
    const r = await outbox.drain();
    expect(rows().map((x) => x.status)).toEqual(["NEEDS_ATTENTION", "SAVED_LOCAL"]);
    expect(r.nextWakeAt).toBeNull(); // nothing to wake for: the held command waits for a person
    await outbox.discard(rows()[0].id);
    await outbox.drain();
    expect(rows().map((x) => x.status)).toEqual(["DISCARDED", "ACCEPTED"]);
  });
});

describe("refusals and retries", () => {
  const run = async (err: ApiError, handler: Partial<CommandHandler<Note>> = {}) => {
    const t = setup(noteHandler({ send: async () => { throw err; }, ...handler }));
    await t.outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("keeps a refusal visible with the server's words and code, never drops it", async () => {
    const row = await run(new ApiError("forbidden", "You cannot log at that site", 403, undefined, "LOCATION_NOT_ALLOWED"));
    expect(row).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access", message: "You cannot log at that site" } });
    expect((await run(new ApiError("bad_request", "Quantity must be positive", 400))).attention?.reason).toBe("rejected");
    expect((await run(new ApiError("conflict", "That id is already used", 409, undefined, "CONFLICT"))).status).toBe("NEEDS_ATTENTION");
  });

  it("treats a 409 the handler calls 'already applied' as done", async () => {
    const row = await run(new ApiError("conflict", "Already confirmed", 409, undefined, "ALREADY_CONFIRMED"), { isApplied: (e) => e.hasCode("ALREADY_CONFIRMED") });
    expect(row.status).toBe("ACCEPTED");
  });

  it("retries a network failure and a 5xx with backoff, and a 429 too", async () => {
    for (const err of [new ApiError("network"), new ApiError("server", undefined, 500), new ApiError("rate_limited", undefined, 429), new ApiError("timeout")]) {
      const row = await run(err);
      expect(row).toMatchObject({ status: "SAVED_LOCAL", attempts: 1, nextAttemptAt: 1_005_000 });
    }
  });

  it("stops a command the server keeps failing on after the handler's limit, but never gives up on a dead network", async () => {
    const { outbox, clock, rows } = setup(noteHandler({ maxServerFailures: 3, send: async () => { throw new ApiError("server", undefined, 500); } }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    for (let i = 0; i < 3; i++) { await outbox.drain(); clock.t += 400_000; }
    expect(rows()[0]).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "server_error" }, serverFailures: 3 });

    const offline = setup(noteHandler({ maxServerFailures: 3, send: async () => { throw new ApiError("network"); } }));
    await offline.outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    for (let i = 0; i < 8; i++) { await offline.outbox.drain(); offline.clock.t += 400_000; }
    expect(offline.rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 8 });
  });

  it("an expired session pauses the queue where it is until sign-in, then everything goes", async () => {
    let signedIn = false;
    const send = vi.fn(async () => { if (!signedIn) throw new ApiError("unauthorized"); });
    const { outbox, rows } = setup(noteHandler({ send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    await outbox.enqueueCommand("note.save", { id: "n2", text: "b" });
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(1); // stopped at the first 401
    expect(rows().map((r) => [r.status, r.attention?.reason])).toEqual([["NEEDS_ATTENTION", "signed_out"], ["SAVED_LOCAL", undefined]]);
    signedIn = true;
    await outbox.requeueSignedOut();
    await outbox.drain();
    expect(rows().map((r) => r.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  });
});

describe("folding a newer command into an unsent one", () => {
  const fold: CommandHandler<Note>["fold"] = (open, incoming, sending) => {
    if (sending) return "append";
    if (incoming.text === "DELETE") return open.type === "note.save" ? "cancel" : { type: "note.save", command: incoming };
    return { type: open.type, command: { ...(open.command as Note), ...incoming } };
  };

  it("merges, cancels or appends depending on the handler, and never touches one being sent", async () => {
    const { outbox, rows, store } = setup(noteHandler({ fold }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    await outbox.enqueueCommand("note.save", { id: "n1", text: "b" });
    expect(rows().map((r) => (r.command as Note).text)).toEqual(["b"]);
    expect(await outbox.enqueueCommand("note.save", { id: "n1", text: "DELETE" })).toBeNull();
    expect(rows()).toHaveLength(0); // never sent, so there is nothing to undo on the server

    await outbox.enqueueCommand("note.save", { id: "n2", text: "a" });
    store.rows.set("id02", { ...store.rows.get("id02")!, status: "SENDING" });
    await outbox.enqueueCommand("note.save", { id: "n2", text: "b" });
    expect(rows().map((r) => [r.status, (r.command as Note).text])).toEqual([["SENDING", "a"], ["SAVED_LOCAL", "b"]]);
  });

  it("a stuck command edited by the person goes back in the queue with its attempts reset", async () => {
    const send = vi.fn(async (c: Note) => { if (c.text === "a") throw new ApiError("bad_request", "No", 400); });
    const { outbox, rows } = setup(noteHandler({ fold, send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "a" });
    await outbox.drain();
    expect(rows()[0].status).toBe("NEEDS_ATTENTION");
    await outbox.enqueueCommand("note.save", { id: "n1", text: "fixed" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 0 });
    expect(rows()[0].attention).toBeUndefined();
    await outbox.drain();
    expect(rows()[0].status).toBe("ACCEPTED");
  });
});

describe("what the screens read", () => {
  it("lists this account's open entries of the given types, and counts the ones waiting", async () => {
    const send = vi.fn(async (c: Note) => { if (c.text === "bad") throw new ApiError("bad_request", "No", 400); });
    const { outbox } = setup(noteHandler({ send }));
    await outbox.enqueueCommand("note.save", { id: "n1", text: "bad" });
    await outbox.enqueueCommand("note.save", { id: "n2", text: "ok" });
    expect((await outbox.open(["note.save"])).map((e) => e.status)).toEqual(["SAVED_LOCAL", "SAVED_LOCAL"]);
    await outbox.drain();
    expect((await outbox.open(["note.save"])).map((e) => e.status)).toEqual(["NEEDS_ATTENTION"]);
    expect((await outbox.open(["something.else"]))).toEqual([]);
  });
});
