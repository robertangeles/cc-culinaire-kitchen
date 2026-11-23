import { describe, it, expect, vi } from "vitest";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError, type ApiClient } from "../api/client";
import { prepHandlers, type PrepCreateCommand, type PrepGenerateCommand, type PrepSelectionsCommand, type PrepTickCommand } from "./prepCommands";

const SESSION = "11111111-1111-4111-8111-111111111111";
const tick = (over: Partial<PrepTickCommand> = {}): PrepTickCommand => ({ prepTaskId: "t1", prepSessionId: SESSION, label: "Onion", status: "completed", completedAt: "2026-11-23T01:00:00.000Z", ...over });
const create = (over: Partial<PrepCreateCommand> = {}): PrepCreateCommand => ({ prepSessionId: SESSION, storeLocationId: "L1", prepDate: "2026-11-23", expectedCovers: 80, ...over });
const selections = (over: Partial<PrepSelectionsCommand> = {}): PrepSelectionsCommand => ({ prepSessionId: SESSION, selections: [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 12 }], ...over });
const generate = (over: Partial<PrepGenerateCommand> = {}): PrepGenerateCommand => ({ prepSessionId: SESSION, requestId: "22222222-2222-4222-8222-222222222222", ...over });

function setup(request: ReturnType<typeof vi.fn> = vi.fn(async () => ({}))) {
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, handlers: prepHandlers({ request } as unknown as ApiClient), now: () => 1_000_000, newId: () => `e${++n}`, getUserId: () => 1 });
  return { outbox, request, rows: () => [...rows.values()] };
}

describe("prep requests", () => {
  it("sends a tick as a PATCH of the status with the time the cook ticked it", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("prep.tick", tick());
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("PATCH", "/api/prep/tasks/t1", { body: { status: "completed", completedAt: "2026-11-23T01:00:00.000Z" } });
  });

  it("sends an untick or a skip with no completion time, and no expectedStatus (a tap is the cook's word)", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("prep.tick", tick({ prepTaskId: "t1", status: "pending", completedAt: null }));
    await outbox.enqueueCommand("prep.tick", tick({ prepTaskId: "t2", status: "skipped", completedAt: null }));
    await outbox.drain();
    expect(request).toHaveBeenCalledWith("PATCH", "/api/prep/tasks/t1", { body: { status: "pending" } });
    expect(request).toHaveBeenCalledWith("PATCH", "/api/prep/tasks/t2", { body: { status: "skipped" } });
  });

  it("sends the plan as create, then selections, then generate, each with the id the phone made, in that order", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("prep.create", create());
    await outbox.enqueueCommand("prep.selections", selections());
    await outbox.enqueueCommand("prep.generate", generate());
    await outbox.drain();
    expect(request.mock.calls.map((c) => [c[0], c[1]])).toEqual([["POST", "/api/prep/sessions"], ["POST", `/api/prep/sessions/${SESSION}/selections`], ["POST", `/api/prep/sessions/${SESSION}/generate`]]);
    expect(request.mock.calls[0][2]).toEqual({ body: { prepSessionId: SESSION, storeLocationId: "L1", prepDate: "2026-11-23", expectedCovers: 80 } });
    expect(request.mock.calls[1][2]).toEqual({ body: { selections: [{ menuItemId: "m1", dishName: "Soup", expectedPortions: 12 }] } });
    expect(request.mock.calls[2][2]).toEqual({ body: { requestId: generate().requestId } });
  });

  it("leaves expectedCovers out when the cook gave none", async () => {
    const { outbox, request } = setup();
    await outbox.enqueueCommand("prep.create", create({ expectedCovers: null }));
    await outbox.drain();
    expect((request.mock.calls[0][2] as { body: Record<string, unknown> }).body).not.toHaveProperty("expectedCovers");
  });
});

describe("prep outcomes", () => {
  const fail = async (err: ApiError, type: string, command: unknown) => {
    const t = setup(vi.fn(async () => { throw err; }));
    await t.outbox.enqueueCommand(type, command);
    await t.outbox.drain();
    return t.rows()[0];
  };

  it("keeps a tick on a session that ended visible, with the server's words (a refusal is never 'already applied')", async () => {
    expect(await fail(new ApiError("conflict", "This prep session has ended", 409, undefined, "PREP_SESSION_ENDED"), "prep.tick", tick())).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "This prep session has ended" } });
  });

  it("keeps a tick from someone who does not work at the location visible", async () => {
    expect(await fail(new ApiError("forbidden", "You do not work at this session's location", 403, undefined, "FORBIDDEN"), "prep.tick", tick())).toMatchObject({ status: "NEEDS_ATTENTION", attention: { reason: "no_access" } });
  });

  it("keeps a tick on a task that is gone (the list was rebuilt) visible", async () => {
    expect((await fail(new ApiError("not_found", "Task not found", 404, undefined, "NOT_FOUND"), "prep.tick", tick())).status).toBe("NEEDS_ATTENTION");
  });

  it("keeps a refused plan visible: an id held by someone else, a location the cook does not work at, a session that ended", async () => {
    expect((await fail(new ApiError("conflict", "id used", 409, undefined, "CONFLICT"), "prep.create", create())).status).toBe("NEEDS_ATTENTION");
    expect((await fail(new ApiError("forbidden", "no", 403, undefined, "LOCATION_NOT_ALLOWED"), "prep.create", create())).status).toBe("NEEDS_ATTENTION");
    expect((await fail(new ApiError("conflict", "ended", 409, undefined, "PREP_SESSION_ENDED"), "prep.generate", generate())).status).toBe("NEEDS_ATTENTION");
  });

  it("retries after a dead network without counting it against the command", async () => {
    const t = setup(vi.fn(async () => { throw new ApiError("network"); }));
    await t.outbox.enqueueCommand("prep.tick", tick());
    await t.outbox.drain();
    expect(t.rows()[0]).toMatchObject({ status: "SAVED_LOCAL", attempts: 1, serverFailures: 0 });
  });

  it("stops retrying a command the server keeps failing on after five tries", () => {
    expect(prepHandlers({} as ApiClient).map((h) => h.maxServerFailures)).toEqual([5, 5, 5, 5]);
  });
});

describe("changing what has not been sent", () => {
  it("keeps only the newest tick for a task, even if the cook went back and forth", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("prep.tick", tick({ status: "completed" }));
    await outbox.enqueueCommand("prep.tick", tick({ status: "pending", completedAt: null }));
    await outbox.enqueueCommand("prep.tick", tick({ status: "skipped", completedAt: null }));
    expect(rows()).toHaveLength(1);
    await outbox.drain();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("PATCH", "/api/prep/tasks/t1", { body: { status: "skipped" } });
  });

  it("keeps ticks for different tasks apart", async () => {
    const { outbox, rows } = setup();
    await outbox.enqueueCommand("prep.tick", tick({ prepTaskId: "t1" }));
    await outbox.enqueueCommand("prep.tick", tick({ prepTaskId: "t2" }));
    expect(rows()).toHaveLength(2);
  });

  it("the newest tick replaces an older one even after the older was tried: a status is absolute, so the last word wins", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError("network")).mockResolvedValue({});
    const { outbox, rows } = setup(send);
    await outbox.enqueueCommand("prep.tick", tick({ status: "completed" }));
    await outbox.drain();
    await outbox.enqueueCommand("prep.tick", tick({ status: "pending", completedAt: null }));
    expect(rows().map((r) => (r.command as PrepTickCommand).status)).toEqual(["pending"]);
  });

  it("a newer plan of dishes replaces an unsent one, and the order create, selections, generate is kept", async () => {
    const { outbox, request, rows } = setup();
    await outbox.enqueueCommand("prep.create", create());
    await outbox.enqueueCommand("prep.selections", selections());
    await outbox.enqueueCommand("prep.selections", selections({ selections: [{ menuItemId: "m2", dishName: "Pie", expectedPortions: 4 }] }));
    await outbox.enqueueCommand("prep.generate", generate());
    expect(rows().map((r) => r.type)).toEqual(["prep.create", "prep.selections", "prep.generate"]);
    await outbox.drain();
    expect((request.mock.calls[1][2] as { body: { selections: unknown[] } }).body.selections).toEqual([{ menuItemId: "m2", dishName: "Pie", expectedPortions: 4 }]);
  });

  it("discarding the refused create discards the selections and generate that depended on it", async () => {
    const { outbox, rows } = setup(vi.fn(async () => { throw new ApiError("forbidden", "no", 403, undefined, "LOCATION_NOT_ALLOWED"); }));
    await outbox.enqueueCommand("prep.create", create());
    await outbox.enqueueCommand("prep.selections", selections());
    await outbox.enqueueCommand("prep.generate", generate());
    await outbox.drain();
    const first = rows().find((r) => r.type === "prep.create")!;
    expect(first.status).toBe("NEEDS_ATTENTION");
    await outbox.discard(first.id);
    expect(rows().map((r) => r.status)).toEqual(["DISCARDED", "DISCARDED", "DISCARDED"]);
  });

  it("describes each command for the sync list", () => {
    const h = Object.fromEntries(prepHandlers({} as ApiClient).map((x) => [x.type, x]));
    expect(h["prep.tick"].describe?.(tick())).toBe("Prep: Onion done");
    expect(h["prep.tick"].describe?.(tick({ status: "pending" }))).toBe("Prep: Onion back to to-do");
    expect(h["prep.tick"].describe?.(tick({ status: "skipped" }))).toBe("Prep: Onion skipped");
    expect(h["prep.generate"].describe?.(generate())).toBe("Make today's prep list");
  });
});
