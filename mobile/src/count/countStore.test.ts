import { describe, it, expect, vi } from "vitest";
import { createCountStore } from "./countStore";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../outbox/outbox";
import { ApiError } from "../api/client";
import type { ActiveSession, AreaSheet, CountApi } from "./countApi";
import type { KvStore } from "../storage/kv";

const mine = 1;
const cat = (name: string, over: object = {}) => ({ categoryId: `c-${name}`, categoryName: name, categoryStatus: "NOT_STARTED", claimedByUserId: null, claimedByUserName: null, claimRevision: 0, ...over });
const session = (over: Partial<ActiveSession> = {}): ActiveSession => ({ sessionId: "S1", sessionStatus: "OPEN", countMode: "AREA", locationName: "Main", categories: [cat("Bar", { categoryStatus: "IN_PROGRESS", claimedByUserId: mine, claimRevision: 2 }), cat("Kitchen")], ...over });
const sheets: AreaSheet[] = [
  { categoryId: "c-Bar", categoryName: "Bar", items: [{ ingredientId: "i1", ingredientName: "Shiraz", countUnit: "kg", alsoIn: ["Stock Room"] }] },
  { categoryId: "c-Kitchen", categoryName: "Kitchen", items: [{ ingredientId: "i2", ingredientName: "Flour", countUnit: "kg", alsoIn: [] }] },
];

type Mocks = Record<keyof CountApi, ReturnType<typeof vi.fn>>;

function setup(over: Partial<Mocks> = {}) {
  const api = {
    activeSession: vi.fn(async () => session()),
    countSheets: vi.fn(async () => sheets),
    areaLines: vi.fn(async () => [{ ingredientId: "i1", rawQty: 4, countedUnit: "kg" }]),
    claimArea: vi.fn(async () => ({ status: "claimed" as const, categoryId: "c-Kitchen", claimRevision: 5 })),
    submitArea: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } as Mocks;
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const keys = () => [...kvMap.keys()];
  const rows = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...rows.values()].sort((a, b) => a.createdAt - b.createdAt), put: async (e) => void rows.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => rows.delete(i)) };
  let n = 0;
  const outbox = createOutbox({ store, send: async () => {}, now: () => 1000 + n, newId: () => `e${++n}`, getUserId: () => mine });
  const kick = vi.fn();
  const counts = createCountStore({ api: api as unknown as CountApi, kv, outbox, getUserId: () => mine, locationId: "L1", kick });
  return { counts, api, outbox, kick, kv, keys, rows };
}
const state = (c: ReturnType<typeof setup>["counts"]) => c.getSnapshot();

describe("loading the stock take", () => {
  it("downloads the session, the sheets and the saved lines of areas this chef holds", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    expect(state(counts)).toMatchObject({ phase: "ready", offline: false, session: { sessionId: "S1" }, sheets });
    expect(api.areaLines).toHaveBeenCalledTimes(1);
    expect(api.areaLines).toHaveBeenCalledWith("S1", "Bar");
  });

  it("says so when no stock take is open, and when it counts by category", async () => {
    const none = setup({ activeSession: vi.fn(async () => null) });
    await none.counts.refresh();
    expect(state(none.counts).phase).toBe("none");

    const byCategory = setup({ activeSession: vi.fn(async () => session({ countMode: "CATEGORY" })) });
    await byCategory.counts.refresh();
    expect(state(byCategory.counts).phase).toBe("categoryMode");
  });

  it("opens from what was last downloaded when there is no signal", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    api.activeSession.mockRejectedValueOnce(new ApiError("network"));
    await counts.refresh();
    expect(state(counts)).toMatchObject({ phase: "ready", offline: true, session: { sessionId: "S1" }, sheets });
  });

  it("asks to connect when there is no signal and nothing downloaded yet", async () => {
    const { counts } = setup({ activeSession: vi.fn(async () => { throw new ApiError("network"); }) });
    await counts.refresh();
    expect(state(counts)).toMatchObject({ phase: "error", error: "Connect to download the stock take." });
  });
});

describe("opening an area to count", () => {
  it("claims a free area online and remembers the claim revision", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    expect(await counts.openArea("Kitchen")).toEqual({ status: "claimed" });
    expect(api.claimArea).toHaveBeenCalledWith("S1", "Kitchen");
    expect(state(counts).claims.Kitchen).toEqual({ claimRevision: 5 });
  });

  it("an area this chef already holds opens offline from the saved claim", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    api.claimArea.mockRejectedValue(new ApiError("network"));
    expect(await counts.openArea("Bar")).toEqual({ status: "claimed" });
    expect(api.claimArea).not.toHaveBeenCalled();
  });

  it("an area that needs claiming cannot be started offline", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    api.claimArea.mockRejectedValue(new ApiError("network"));
    expect(await counts.openArea("Kitchen")).toEqual({ status: "offline" });
  });

  it("reports an area another chef holds or that is already submitted, without changing anything", async () => {
    const held = setup({ claimArea: vi.fn(async () => ({ status: "held" as const })) });
    await held.counts.refresh();
    expect(await held.counts.openArea("Kitchen")).toEqual({ status: "held" });
    const sub = setup({ claimArea: vi.fn(async () => ({ status: "submitted" as const })) });
    await sub.counts.refresh();
    expect(await sub.counts.openArea("Kitchen")).toEqual({ status: "submitted" });
  });
});

describe("counting", () => {
  it("saves a count to the outbox under the current claim and kicks the sender", async () => {
    const { counts, outbox, kick } = setup();
    await counts.refresh();
    await counts.saveCount("Bar", { ingredientId: "i1", ingredientName: "Shiraz", rawQty: 6, countedUnit: "kg" });
    const [e] = await outbox.entriesFor("S1", "Bar");
    expect(e.command).toMatchObject({ sessionId: "S1", categoryName: "Bar", ingredientId: "i1", rawQty: 6, claimRevision: 2 });
    expect(kick).toHaveBeenCalled();
  });

  it("shows the phone's number over the server's, with its save state", async () => {
    const { counts } = setup();
    await counts.refresh();
    expect(counts.answers("Bar").get("i1")).toMatchObject({ rawQty: 4, saveState: "accepted" });
    await counts.saveCount("Bar", { ingredientId: "i1", ingredientName: "Shiraz", rawQty: 6, countedUnit: "kg" });
    expect(counts.answers("Bar").get("i1")).toMatchObject({ rawQty: 6, saveState: "saved_on_phone" });
  });
});

describe("submitting an area", () => {
  it("is blocked here while a count is still waiting to send, without calling the server", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    await counts.saveCount("Bar", { ingredientId: "i1", ingredientName: "Shiraz", rawQty: 6, countedUnit: "kg" });
    const out = await counts.submit("Bar");
    expect(out).toMatchObject({ ok: false, reason: "blocked" });
    expect(api.submitArea).not.toHaveBeenCalled();
  });

  it("sends the claim revision when everything has reached the server, then reloads", async () => {
    const { counts, api } = setup();
    await counts.refresh();
    expect(await counts.submit("Bar")).toEqual({ ok: true });
    expect(api.submitArea).toHaveBeenCalledWith("S1", "Bar", 2);
    expect(api.activeSession).toHaveBeenCalledTimes(2);
  });

  it("returns the shared items the server says are still missing", async () => {
    const missing = [{ ingredientId: "i1", ingredientName: "Shiraz", areaNames: ["Stock Room"] }];
    const { counts } = setup({ submitArea: vi.fn(async () => ({ ok: false as const, missing, message: "Count these" })) });
    await counts.refresh();
    expect(await counts.submit("Bar")).toEqual({ ok: false, reason: "missing", missing, message: "Count these" });
  });

  it("explains that submitting needs a connection", async () => {
    const { counts } = setup({ submitArea: vi.fn(async () => { throw new ApiError("network"); }) });
    await counts.refresh();
    expect(await counts.submit("Bar")).toMatchObject({ ok: false, reason: "error", message: "Can't reach the server. Try again." });
  });
});

describe("stuck counts and other accounts (found in review)", () => {
  it("shows stuck counts from any stock take, not only the open one", async () => {
    const { counts, outbox, rows } = setup();
    await counts.refresh();
    await outbox.enqueue({ sessionId: "OLD", categoryName: "Cellar", ingredientId: "x", ingredientName: "Rum", rawQty: 2, countedUnit: "kg", claimRevision: 1 });
    const [old] = [...rows.values()];
    rows.set(old.id, { ...old, status: "NEEDS_ATTENTION", attention: { reason: "area_closed", message: "Cannot count: category is SUBMITTED" } });
    await counts.refresh();
    expect(state(counts).stuck.map((e) => e.command.ingredientName)).toEqual(["Rum"]);
  });

  it("counts unsent counts that belong to another account", async () => {
    const { counts, rows } = setup();
    rows.set("other", { id: "other", userId: 99, type: "count.saveLine", version: 1, serverFailures: 0, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, createdAt: 1, updatedAt: 1, command: { sessionId: "S1", categoryName: "Bar", ingredientId: "i1", ingredientName: "Shiraz", rawQty: 1, countedUnit: "kg", claimRevision: 1 } });
    await counts.refresh();
    expect(state(counts).otherAccountPending).toBe(1);
  });

  it("keeps each account's downloaded stock take under its own key", async () => {
    const { keys, counts } = setup();
    await counts.refresh();
    expect(keys()).toEqual(["count.1.L1"]);
  });

  it("stops listening to the outbox when disposed", async () => {
    const { counts, outbox } = setup();
    await counts.refresh();
    counts.dispose();
    const before = state(counts);
    await outbox.enqueue({ sessionId: "S1", categoryName: "Bar", ingredientId: "i1", ingredientName: "Shiraz", rawQty: 5, countedUnit: "kg", claimRevision: 2 });
    expect(state(counts)).toBe(before);
  });
});

